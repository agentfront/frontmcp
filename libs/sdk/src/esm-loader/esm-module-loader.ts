/**
 * @file esm-module-loader.ts
 * @description Core engine for dynamically loading npm packages.
 *
 * Supports two runtime environments:
 * - **Node.js**: fetch → cache to disk → import() from file:// URL
 * - **Browser**: fetch → in-memory cache → evaluate via Function constructor
 */

import type { FrontMcpLogger } from '../common';
import type { EsmRegistryAuth } from './esm-auth.types';
import type { EsmCacheManager, EsmCacheEntry } from './esm-cache';
import type { ParsedPackageSpecifier } from './package-specifier';
import type { FrontMcpPackageManifest } from './esm-manifest';
import { buildEsmShUrl } from './package-specifier';
import { normalizeEsmExport } from './esm-manifest';
import { VersionResolver } from './version-resolver';

/**
 * Dynamic `import()` of a runtime-computed specifier.
 *
 * This loader's only job is to import npm packages / bundles from disk, blob, or
 * temp files — a Node/browser concern that never executes on a V8 isolate
 * (Cloudflare Workers). `export * from './esm-loader'` in the SDK barrel still
 * pulls this module into a worker bundle, so the dynamic specifier carries the
 * `webpackIgnore` + `@vite-ignore` magic comments to tell bundlers not to try to
 * resolve it at build time; the call site is simply never reached in a worker.
 *
 * It MUST stay a real `import()` expression (not hidden behind `new Function`):
 * Jest's swc transform rewrites a literal `import()` to a runtime it can execute,
 * whereas a `new Function('s','return import(s)')` body becomes a native VM
 * dynamic import that throws `A dynamic import callback was invoked without
 * --experimental-vm-modules` (and that flag breaks the rest of the suite). The
 * `webpackIgnore`/`@vite-ignore` comments already keep the worker bundle happy
 * (verified by the demo-e2e-cloudflare workerd boot), so no further indirection
 * is needed.
 */
function importComputed(specifier: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
}

/**
 * Result of loading an ESM package.
 */
export interface EsmLoadResult {
  /** Normalized package manifest with primitives */
  manifest: FrontMcpPackageManifest;
  /** Concrete version that was loaded */
  resolvedVersion: string;
  /** Whether the bundle came from cache or network */
  source: 'cache' | 'network';
  /** Timestamp when the load completed */
  loadedAt: number;
  /** The raw module export (for direct access to classes/functions) */
  rawModule: unknown;
}

/**
 * Options for the ESM module loader.
 */
export interface EsmModuleLoaderOptions {
  /** Cache manager for storing ESM bundles */
  cache: EsmCacheManager;
  /** Authentication for private registries */
  registryAuth?: EsmRegistryAuth;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Logger instance */
  logger?: FrontMcpLogger;
  /** Custom ESM CDN base URL */
  esmBaseUrl?: string;
}

/**
 * Core ESM module loader.
 *
 * Loads npm packages dynamically at runtime:
 * 1. Resolves semver range to concrete version via npm registry
 * 2. Checks cache for the resolved version (in-memory + disk)
 * 3. On cache miss, fetches the bundle from esm.sh (or custom CDN)
 * 4. Caches the bundle (disk in Node.js, in-memory in browser)
 * 5. Evaluates the module (import() in Node.js, Function constructor in browser)
 * 6. Normalizes the module export into a FrontMcpPackageManifest
 */
export class EsmModuleLoader {
  private readonly cache: EsmCacheManager;
  private readonly versionResolver: VersionResolver;
  private readonly timeout: number;
  private readonly logger?: FrontMcpLogger;
  private readonly esmBaseUrl?: string;

  constructor(options: EsmModuleLoaderOptions) {
    this.cache = options.cache;
    this.timeout = options.timeout ?? 30000;
    this.logger = options.logger;
    this.esmBaseUrl = options.esmBaseUrl;
    this.versionResolver = new VersionResolver({
      registryAuth: options.registryAuth,
      timeout: options.timeout,
    });
  }

  /**
   * Load an npm package and return its normalized manifest.
   *
   * @param specifier - Parsed package specifier
   * @returns Load result with manifest and metadata
   */
  async load(specifier: ParsedPackageSpecifier): Promise<EsmLoadResult> {
    this.logger?.debug(`Loading ESM package: ${specifier.fullName}@${specifier.range}`);

    // Step 1: Resolve semver range to concrete version
    const resolvedVersion = await this.resolveVersion(specifier);
    this.logger?.debug(`Resolved ${specifier.fullName}@${specifier.range} → ${resolvedVersion}`);

    // Step 2: Check cache
    const cached = await this.cache.get(specifier.fullName, resolvedVersion);
    if (cached) {
      this.logger?.debug(`Cache hit for ${specifier.fullName}@${resolvedVersion}`);
      return this.loadFromCache(cached);
    }

    // Step 3: Fetch from esm.sh
    this.logger?.debug(`Cache miss, fetching ${specifier.fullName}@${resolvedVersion} from esm.sh`);
    return this.fetchAndCache(specifier, resolvedVersion);
  }

  /**
   * Resolve a package specifier's range to a concrete version.
   */
  async resolveVersion(specifier: ParsedPackageSpecifier): Promise<string> {
    const result = await this.versionResolver.resolve(specifier);
    return result.resolvedVersion;
  }

  /**
   * Load a module from a cached bundle.
   */
  private async loadFromCache(entry: EsmCacheEntry): Promise<EsmLoadResult> {
    let rawModule: unknown;

    if (entry.bundlePath) {
      // In Node.js, always prefer the cached file so ESM stays native and CJS uses
      // the same disk bridge that Jest and regular import() both understand.
      try {
        rawModule = await this.importFromPath(entry.bundlePath);
      } catch (error) {
        if (!entry.bundleContent) {
          throw error;
        }

        // If the disk artifact disappears after a warm cache hit, fall back to the
        // in-memory copy instead of failing the whole load.
        this.logger?.debug(
          `importFromPath failed for ${entry.bundlePath}, falling back to in-memory bundle: ${(error as Error).message}`,
        );
        rawModule = await this.importBundle(entry.bundleContent);
      }
    } else if (entry.bundleContent) {
      // Browser mode or in-memory-only fallback
      rawModule = await this.importBundle(entry.bundleContent);
    } else {
      throw new Error(`Cached bundle for "${entry.packageName}@${entry.resolvedVersion}" has no importable content`);
    }

    const manifest = normalizeEsmExport(rawModule);

    return {
      manifest,
      resolvedVersion: entry.resolvedVersion,
      source: 'cache',
      loadedAt: Date.now(),
      rawModule,
    };
  }

  /**
   * Fetch ESM bundle from esm.sh, cache it, and load it.
   */
  private async fetchAndCache(specifier: ParsedPackageSpecifier, resolvedVersion: string): Promise<EsmLoadResult> {
    const url = buildEsmShUrl(specifier, resolvedVersion, {
      baseUrl: this.esmBaseUrl,
      bundle: true,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(
          `Timeout fetching ESM bundle for "${specifier.fullName}@${resolvedVersion}" after ${this.timeout}ms`,
        );
      }
      throw new Error(
        `Failed to fetch ESM bundle for "${specifier.fullName}@${resolvedVersion}": ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(
        `esm.sh returned ${response.status} for "${specifier.fullName}@${resolvedVersion}": ${response.statusText}`,
      );
    }

    const bundleContent = await response.text();
    const etag = response.headers.get('etag') ?? undefined;

    // Cache the bundle (disk + memory in Node.js, memory-only in browser)
    const entry = await this.cache.put(specifier.fullName, resolvedVersion, bundleContent, url, etag);

    // Import the bundle
    const rawModule = entry.bundlePath
      ? await this.importFromPath(entry.bundlePath)
      : await this.importBundle(bundleContent);

    const manifest = normalizeEsmExport(rawModule);

    this.logger?.info(`Loaded ${specifier.fullName}@${resolvedVersion} from esm.sh`);

    return {
      manifest,
      resolvedVersion,
      source: 'network',
      loadedAt: Date.now(),
      rawModule,
    };
  }

  /**
   * Import a bundle from a local file path (Node.js only).
   * Uses dynamic import with file:// URL for cross-platform compatibility.
   */
  private async importFromPath(filePath: string): Promise<unknown> {
    const { pathToFileURL } = await import('node:url');
    // NO cache-busting query. The disk cache path is keyed by package@version
    // (an immutable coordinate — see EsmCache.getEntryDir), so the same path
    // always holds the same content and reusing Node's ESM module cache is
    // correct; a new version resolves to a new path and is imported fresh.
    //
    // A `?t=${Date.now()}` here made every import a UNIQUE URL. Node's internal
    // ESM module registry is keyed by full URL and is never garbage-collected,
    // so under VersionPoller-driven reloads a long-running server leaked one
    // retained module per reload (unbounded heap growth) for no benefit.
    return importComputed(pathToFileURL(filePath).href);
  }

  /**
   * Import a bundle from its source text.
   * Detects ESM vs CJS and uses the appropriate evaluation strategy.
   */
  private async importBundle(bundleContent: string): Promise<unknown> {
    if (this.looksLikeEsm(bundleContent)) {
      return this.importEsmBundle(bundleContent);
    }
    // CJS path: Function constructor with module/exports scope
    const module = { exports: {} as Record<string, unknown> };
    const fn = new Function('module', 'exports', bundleContent);
    fn(module, module.exports);
    return module.exports;
  }

  /**
   * Heuristic: content uses ESM export/import syntax at line boundaries.
   */
  private looksLikeEsm(content: string): boolean {
    return /^\s*(export\s|import\s)/m.test(content);
  }

  /**
   * Import ESM content via Blob URL (browser) or temp file (Node.js).
   */
  private async importEsmBundle(bundleContent: string): Promise<unknown> {
    // Browser: Blob + URL.createObjectURL + dynamic import
    if (typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function') {
      const blob = new Blob([bundleContent], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        return await importComputed(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    // Node.js: write to a CONTENT-ADDRESSED temp file and use native import().
    // The filename is the bundle's SHA-256, so identical content always maps to
    // the same module URL — Node's ESM registry (never GC'd) keeps ONE entry per
    // distinct bundle rather than leaking a fresh entry on every reload, and a
    // re-import of unchanged content is a no-op write + cached module.
    //
    // The file is intentionally NOT deleted: it's a small content cache (bounded
    // by distinct bundle contents; the OS reclaims tmp on reboot), and deleting
    // it after import previously (a) added write/delete churn per call and
    // (b) still leaked the registry entry via the old `?t=${Date.now()}`.
    //
    // This branch is only the fallback for when the version-keyed disk cache
    // artifact is unavailable; the primary path imports that file directly.
    const { ensureDir, fileExists, sha256Hex, writeFile } = await import('@frontmcp/utils');
    const nodePath = await import('node:path');
    const nodeOs = await import('node:os');
    const { pathToFileURL } = await import('node:url');

    const dir = nodePath.join(nodeOs.tmpdir(), 'frontmcp-esm-modules');
    await ensureDir(dir);
    const tempPath = nodePath.join(dir, `${sha256Hex(bundleContent)}.mjs`);
    if (!(await fileExists(tempPath))) {
      await writeFile(tempPath, bundleContent);
    }
    return importComputed(pathToFileURL(tempPath).href);
  }
}
