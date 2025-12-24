/**
 * Component Builder
 *
 * Builds file-based UI components with caching and CDN dependency resolution.
 * Handles the complete build pipeline from source to cached manifest.
 *
 * @packageDocumentation
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, extname } from 'path';
import { randomUUID } from 'crypto';

import type {
  ComponentBuildManifest,
  FileBundleOptions,
  CDNDependency,
  CDNPlatformType,
  ResolvedDependency,
} from '../../dependency/types';
import type { BuildCacheStorage } from './storage/interface';
import { calculateComponentHash } from './hash-calculator';
import { DependencyResolver } from '../../dependency/resolver';
import { createImportMap, generateDependencyHTML } from '../../dependency/import-map';

// Type-only definition for React-like component types (no runtime dependency)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReactComponentType<P = any> = ((props: P) => unknown) & { displayName?: string; name?: string };

// ============================================
// Builder Options
// ============================================

/**
 * Options for building a component.
 */
export interface ComponentBuildOptions {
  /**
   * Entry file path.
   */
  entryPath: string;

  /**
   * Tool name for the component.
   */
  toolName: string;

  /**
   * Packages to load from CDN.
   */
  externals?: string[];

  /**
   * Explicit CDN dependency overrides.
   */
  dependencies?: Record<string, CDNDependency>;

  /**
   * Bundle options.
   */
  bundleOptions?: FileBundleOptions;

  /**
   * Target platform for CDN selection.
   * @default 'unknown'
   */
  platform?: CDNPlatformType;

  /**
   * Whether to skip cache lookup.
   * @default false
   */
  skipCache?: boolean;

  /**
   * Whether to perform SSR.
   * @default false
   */
  ssr?: boolean;

  /**
   * SSR context data.
   */
  ssrContext?: Record<string, unknown>;

  /**
   * Custom code execution function for SSR.
   * Allows different strategies for Node.js vs browser environments.
   * If not provided, uses `new Function()` which works in both environments.
   *
   * @example
   * ```typescript
   * // Custom execution with vm module
   * import { createContext, runInContext } from 'vm';
   *
   * const options = {
   *   executeCode: (code, exports, module, React) => {
   *     const context = createContext({ exports, module, React });
   *     runInContext(code, context);
   *   }
   * };
   * ```
   */
  executeCode?: (
    code: string,
    exports: Record<string, unknown>,
    module: { exports: Record<string, unknown> },
    React: unknown,
  ) => void;
}

/**
 * Result of a build operation.
 */
export interface ComponentBuildResult {
  /**
   * The build manifest.
   */
  manifest: ComponentBuildManifest;

  /**
   * Whether the result came from cache.
   */
  cached: boolean;

  /**
   * Build time in milliseconds.
   */
  buildTimeMs: number;
}

// ============================================
// Builder Class
// ============================================

/**
 * Component builder for file-based UI templates.
 *
 * Handles the complete build pipeline:
 * 1. Check cache for existing build
 * 2. Parse entry file for imports
 * 3. Resolve external dependencies to CDN URLs
 * 4. Bundle the component with esbuild
 * 5. Generate import map for CDN dependencies
 * 6. Store result in cache
 *
 * @example
 * ```typescript
 * const storage = new FilesystemStorage({ cacheDir: '.cache' });
 * await storage.initialize();
 *
 * const builder = new ComponentBuilder(storage);
 *
 * const result = await builder.build({
 *   entryPath: './widgets/chart.tsx',
 *   toolName: 'chart_display',
 *   externals: ['chart.js', 'react'],
 *   platform: 'claude',
 * });
 *
 * console.log(result.manifest.outputs.code);
 * console.log(result.manifest.importMap);
 * ```
 */
export class ComponentBuilder {
  private readonly storage: BuildCacheStorage;
  private esbuild: typeof import('esbuild') | null = null;

  constructor(storage: BuildCacheStorage) {
    this.storage = storage;
  }

  /**
   * Build a component from a file path.
   */
  async build(options: ComponentBuildOptions): Promise<ComponentBuildResult> {
    const startTime = performance.now();
    const {
      entryPath,
      toolName,
      externals = [],
      dependencies = {},
      bundleOptions = {},
      platform = 'unknown',
      skipCache = false,
      ssr = false,
      ssrContext = {},
      executeCode,
    } = options;

    // Resolve absolute path
    const absoluteEntryPath = resolve(entryPath);

    if (!existsSync(absoluteEntryPath)) {
      throw new Error(`Entry file not found: ${absoluteEntryPath}`);
    }

    // Calculate content hash
    const hashResult = await calculateComponentHash({
      entryPath: absoluteEntryPath,
      externals,
      dependencies,
      bundleOptions,
    });

    // Check cache
    if (!skipCache) {
      const cached = await this.storage.get(hashResult.hash);
      if (cached) {
        return {
          manifest: cached,
          cached: true,
          buildTimeMs: performance.now() - startTime,
        };
      }
    }

    // Read entry file
    const source = await readFile(absoluteEntryPath, 'utf8');

    // Resolve external dependencies
    const resolver = new DependencyResolver({ platform });
    const resolvedDeps: ResolvedDependency[] = [];

    for (const pkg of externals) {
      try {
        const override = dependencies[pkg];
        const resolved = resolver.resolve(pkg, override);
        if (resolved) {
          resolvedDeps.push(resolved);
        }
        // If resolved is null, package will be bundled instead of loaded from CDN
      } catch (error) {
        // Log warning but continue - package will be bundled instead
        console.warn(`Failed to resolve external "${pkg}": ${error}`);
      }
    }

    // Add peer dependencies
    const allExternals = new Set(externals);
    for (const dep of resolvedDeps) {
      const entry = resolver.getRegistry()[dep.packageName];
      if (entry?.providers) {
        const providerConfig = Object.values(entry.providers)[0];
        if (providerConfig?.peerDependencies) {
          for (const peer of providerConfig.peerDependencies) {
            if (!allExternals.has(peer)) {
              allExternals.add(peer);
              try {
                const peerOverride = dependencies[peer];
                const resolved = resolver.resolve(peer, peerOverride);
                if (resolved) {
                  resolvedDeps.push(resolved);
                }
              } catch {
                // Ignore - peer may not be needed
              }
            }
          }
        }
      }
    }

    // Generate import map
    const importMap = createImportMap(resolvedDeps);

    // Bundle the component
    const bundleResult = await this.bundleComponent({
      source,
      entryPath: absoluteEntryPath,
      externals: Array.from(allExternals),
      bundleOptions,
    });

    // Optionally perform SSR
    let ssrHtml: string | undefined;
    if (ssr) {
      ssrHtml = await this.renderSSR(bundleResult.code, ssrContext, resolvedDeps, executeCode);
    }

    // Create manifest
    const manifest: ComponentBuildManifest = {
      version: '1.0',
      buildId: randomUUID(),
      toolName,
      entryPath: absoluteEntryPath,
      contentHash: hashResult.hash,
      dependencies: resolvedDeps,
      outputs: {
        code: bundleResult.code,
        sourceMap: bundleResult.map,
        ssrHtml,
      },
      importMap,
      metadata: {
        createdAt: new Date().toISOString(),
        buildTimeMs: performance.now() - startTime,
        totalSize: Buffer.byteLength(bundleResult.code, 'utf8'),
        bundlerVersion: bundleResult.bundlerVersion,
      },
    };

    // Store in cache
    await this.storage.set(hashResult.hash, manifest);

    return {
      manifest,
      cached: false,
      buildTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Build multiple components.
   */
  async buildMany(options: ComponentBuildOptions[]): Promise<ComponentBuildResult[]> {
    return Promise.all(options.map((opt) => this.build(opt)));
  }

  /**
   * Check if a component needs rebuilding.
   */
  async needsRebuild(
    options: Pick<ComponentBuildOptions, 'entryPath' | 'externals' | 'dependencies' | 'bundleOptions'>,
  ): Promise<boolean> {
    const absoluteEntryPath = resolve(options.entryPath);

    const hashResult = await calculateComponentHash({
      entryPath: absoluteEntryPath,
      externals: options.externals,
      dependencies: options.dependencies,
      bundleOptions: options.bundleOptions,
    });

    const cached = await this.storage.has(hashResult.hash);
    return !cached;
  }

  /**
   * Get a cached build if it exists.
   */
  async getCached(
    options: Pick<ComponentBuildOptions, 'entryPath' | 'externals' | 'dependencies' | 'bundleOptions'>,
  ): Promise<ComponentBuildManifest | undefined> {
    const absoluteEntryPath = resolve(options.entryPath);

    const hashResult = await calculateComponentHash({
      entryPath: absoluteEntryPath,
      externals: options.externals,
      dependencies: options.dependencies,
      bundleOptions: options.bundleOptions,
    });

    return this.storage.get(hashResult.hash);
  }

  /**
   * Invalidate a cached build.
   */
  async invalidate(contentHash: string): Promise<boolean> {
    return this.storage.delete(contentHash);
  }

  /**
   * Generate complete HTML for a built component.
   */
  generateHTML(manifest: ComponentBuildManifest, minify = false): string {
    const parts: string[] = [];

    // Add dependency loading HTML
    const dependencyHtml = generateDependencyHTML(manifest.dependencies, { minify });
    parts.push(dependencyHtml);

    // Add component code
    parts.push(`<script type="module">${manifest.outputs.code}</script>`);

    return parts.join(minify ? '' : '\n');
  }

  /**
   * Bundle a component using esbuild.
   */
  private async bundleComponent(options: {
    source: string;
    entryPath: string;
    externals: string[];
    bundleOptions: FileBundleOptions;
  }): Promise<{ code: string; map?: string; bundlerVersion?: string }> {
    const { source, entryPath, externals, bundleOptions } = options;

    // Lazy load esbuild with webpackIgnore to prevent bundler processing
    if (!this.esbuild) {
      try {
        this.esbuild = await import(/* webpackIgnore: true */ 'esbuild');
      } catch {
        throw new Error('esbuild is required for component building. Install with: npm install esbuild');
      }
    }

    const ext = extname(entryPath).toLowerCase();
    const loader = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'ts' : ext === '.jsx' ? 'jsx' : 'js';

    try {
      const result = await this.esbuild.transform(source, {
        loader,
        format: 'esm',
        minify: bundleOptions.minify ?? process.env['NODE_ENV'] === 'production',
        sourcemap: bundleOptions.sourceMaps ? 'inline' : false,
        target: bundleOptions.target ?? 'es2020',
        treeShaking: bundleOptions.treeShake ?? true,
        jsx: 'automatic',
        jsxImportSource: bundleOptions.jsxImportSource ?? 'react',
        // Mark externals for later import map resolution
        banner: externals.length > 0 ? `/* externals: ${externals.join(', ')} */` : undefined,
      });

      return {
        code: result.code,
        map: result.map || undefined,
        bundlerVersion: this.esbuild.version,
      };
    } catch (error) {
      throw new Error(`Bundle failed for ${entryPath}: ${error}`);
    }
  }

  /**
   * Perform server-side rendering.
   */
  private async renderSSR(
    code: string,
    context: Record<string, unknown>,
    dependencies: ResolvedDependency[],
    executeCode?: (
      code: string,
      exports: Record<string, unknown>,
      module: { exports: Record<string, unknown> },
      React: unknown,
    ) => void,
  ): Promise<string | undefined> {
    // SSR requires React
    const hasReact = dependencies.some((d) => d.packageName === 'react');
    if (!hasReact) {
      console.warn('SSR requires React as an external dependency');
      return undefined;
    }

    try {
      // Dynamic import React for SSR
      // Use variable indirection to prevent bundlers from resolving at bundle time
      const reactPkg = 'react';
      const reactDomServerPkg = 'react-dom/server';
      const React = await import(reactPkg);
      const ReactDOMServer = await import(reactDomServerPkg);

      // Create a sandboxed execution context
      const exports: Record<string, unknown> = {};
      const module = { exports };

      // Execute the bundled code using custom executor or default new Function()
      // SECURITY WARNING: Default execution uses `new Function()` which is equivalent
      // to eval(). For untrusted code, provide a custom `executeCode` callback with
      // proper sandboxing (e.g., Node.js vm module or enclave-vm).
      // Note: new Function() works in both Node.js and browser environments.
      if (executeCode) {
        executeCode(code, exports, module, React);
      } else {
        const fn = new Function('exports', 'module', 'React', code);
        fn(exports, module, React);
      }

      // Get the default export
      const Component = (module.exports as { default?: unknown }).default || module.exports;

      if (typeof Component !== 'function') {
        console.warn('SSR: No default component export found');
        return undefined;
      }

      // Render to string
      const element = React.createElement(Component as ReactComponentType<unknown>, context);
      return ReactDOMServer.renderToString(element);
    } catch (error) {
      console.warn(`SSR failed: ${error}`);
      return undefined;
    }
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a component builder with filesystem storage.
 */
export async function createFilesystemBuilder(cacheDir = '.frontmcp-cache/builds'): Promise<ComponentBuilder> {
  const { FilesystemStorage } = await import('./storage/filesystem.js');
  const storage = new FilesystemStorage({ cacheDir });
  await storage.initialize();
  return new ComponentBuilder(storage);
}

/**
 * Create a component builder with Redis storage.
 */
export async function createRedisBuilder(
  redisClient: import('./storage/redis.js').RedisClient,
  keyPrefix = 'frontmcp:ui:build:',
): Promise<ComponentBuilder> {
  const { RedisStorage } = await import('./storage/redis.js');
  const storage = new RedisStorage({
    client: redisClient,
    keyPrefix,
  });
  await storage.initialize();
  return new ComponentBuilder(storage);
}
