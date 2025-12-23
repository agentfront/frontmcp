/**
 * Dependency Resolver
 *
 * Resolves external npm package imports to CDN URLs.
 * Handles platform-specific CDN selection and dependency ordering.
 *
 * @packageDocumentation
 */

import type {
  CDNDependency,
  CDNPlatformType,
  CDNProvider,
  CDNRegistry,
  DependencyResolverOptions,
  ResolvedDependency,
  ImportMap,
} from './types';
import {
  CDN_PROVIDER_PRIORITY,
  lookupPackage,
  getPackagePeerDependencies,
  resolveAllDependencies,
  mergeRegistries,
} from './cdn-registry';
import { parseImports } from './import-parser';
import { createImportMap } from './import-map';

// ============================================
// Resolver Errors
// ============================================

/**
 * Error thrown when a dependency cannot be resolved.
 */
export class DependencyResolutionError extends Error {
  constructor(public readonly packageName: string, public readonly reason: string) {
    super(`Failed to resolve dependency "${packageName}": ${reason}`);
    this.name = 'DependencyResolutionError';
  }
}

/**
 * Error thrown when no CDN provider is available for a package.
 */
export class NoProviderError extends DependencyResolutionError {
  constructor(packageName: string, public readonly platform: CDNPlatformType) {
    super(packageName, `No CDN provider available for platform "${platform}"`);
    this.name = 'NoProviderError';
  }
}

// ============================================
// Resolver Class
// ============================================

/**
 * Dependency resolver for external npm packages.
 *
 * Resolves package imports to CDN URLs based on platform requirements
 * and dependency relationships.
 *
 * @example
 * ```typescript
 * const resolver = new DependencyResolver({
 *   platform: 'claude',
 * });
 *
 * // Resolve from source code
 * const source = `
 *   import React from 'react';
 *   import { Chart } from 'chart.js';
 * `;
 *
 * const resolved = await resolver.resolveFromSource(source, ['react', 'chart.js']);
 * console.log(resolved.map(d => d.cdnUrl));
 * ```
 */
export class DependencyResolver {
  private readonly options: Required<DependencyResolverOptions>;
  private readonly registry: CDNRegistry;

  constructor(options: DependencyResolverOptions = {}) {
    this.options = {
      platform: options.platform ?? 'unknown',
      preferredProviders: options.preferredProviders ?? CDN_PROVIDER_PRIORITY[options.platform ?? 'unknown'],
      customRegistry: options.customRegistry ?? {},
      strictMode: options.strictMode ?? true,
      requireIntegrity: options.requireIntegrity ?? false,
    };

    this.registry = mergeRegistries(this.options.customRegistry);
  }

  /**
   * Resolve a single package to its CDN dependency.
   *
   * @param packageName - NPM package name
   * @param override - Optional explicit CDN dependency override
   * @returns Resolved dependency, or null in non-strict mode if package is not found (should be bundled)
   * @throws DependencyResolutionError if package cannot be resolved in strict mode
   */
  resolve(packageName: string, override?: CDNDependency): ResolvedDependency | null {
    // Use explicit override if provided
    if (override) {
      // Use 'custom' as provider for overrides since it's user-defined, not from a specific CDN
      return this.createResolvedDependency(packageName, override, 'custom');
    }

    // Look up in registry
    const entry = lookupPackage(packageName, this.registry);
    if (!entry) {
      if (this.options.strictMode) {
        throw new DependencyResolutionError(
          packageName,
          'Package not found in CDN registry. Add it to "dependencies" for explicit CDN configuration.',
        );
      }
      // Non-strict mode: return null to signal package should be bundled instead of loaded from CDN
      return null;
    }

    // Find provider based on platform priority
    const providerPriority = this.options.preferredProviders;

    for (const provider of providerPriority) {
      const config = entry.providers[provider];
      if (config?.url) {
        // Check integrity requirement
        if (this.options.requireIntegrity && !config.integrity) {
          continue;
        }

        return this.createResolvedDependency(packageName, config, provider, entry.defaultVersion);
      }
    }

    // No provider found
    throw new NoProviderError(packageName, this.options.platform);
  }

  /**
   * Resolve multiple packages.
   *
   * @param packageNames - Array of package names
   * @param overrides - Optional explicit overrides for specific packages
   * @returns Array of resolved dependencies (in dependency order)
   */
  resolveMany(packageNames: string[], overrides?: Record<string, CDNDependency>): ResolvedDependency[] {
    // Resolve all dependencies including peers
    const allPackages = resolveAllDependencies(packageNames, this.options.platform, this.registry);

    const resolved: ResolvedDependency[] = [];

    for (const pkgName of allPackages) {
      try {
        const override = overrides?.[pkgName];
        const dep = this.resolve(pkgName, override);
        if (dep) {
          resolved.push(dep);
        }
        // If dep is null, the package will be bundled instead (non-strict mode)
      } catch (error) {
        if (this.options.strictMode) {
          throw error;
        }
        // Non-strict: skip unresolved (will be bundled)
      }
    }

    return resolved;
  }

  /**
   * Resolve dependencies from source code.
   *
   * Parses the source to extract imports, then resolves external packages
   * that are in the externals list.
   *
   * @param source - Source code to parse
   * @param externals - Package names to resolve from CDN (others are bundled)
   * @param overrides - Optional explicit CDN overrides
   * @returns Resolved dependencies
   */
  resolveFromSource(
    source: string,
    externals: string[],
    overrides?: Record<string, CDNDependency>,
  ): ResolvedDependency[] {
    const parseResult = parseImports(source);

    // Filter to only packages in externals list
    const packagesToResolve = parseResult.externalPackages.filter((pkg) => externals.includes(pkg));

    return this.resolveMany(packagesToResolve, overrides);
  }

  /**
   * Generate an import map for resolved dependencies.
   *
   * @param dependencies - Resolved dependencies
   * @returns Browser import map
   */
  generateImportMap(dependencies: ResolvedDependency[]): ImportMap {
    return createImportMap(dependencies);
  }

  /**
   * Check if a package can be resolved for the current platform.
   *
   * @param packageName - Package name to check
   * @returns true if the package can be resolved
   */
  canResolve(packageName: string): boolean {
    try {
      const result = this.resolve(packageName);
      return result !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get the resolved CDN URL for a package.
   *
   * @param packageName - Package name
   * @param override - Optional explicit override
   * @returns CDN URL or undefined if cannot resolve
   */
  getUrl(packageName: string, override?: CDNDependency): string | undefined {
    try {
      const resolved = this.resolve(packageName, override);
      return resolved?.cdnUrl;
    } catch {
      return undefined;
    }
  }

  /**
   * Get peer dependencies for a package.
   */
  getPeerDependencies(packageName: string): string[] {
    return getPackagePeerDependencies(packageName, this.registry);
  }

  /**
   * Create the current registry (default + custom).
   */
  getRegistry(): CDNRegistry {
    return this.registry;
  }

  /**
   * Get the current platform.
   */
  getPlatform(): CDNPlatformType {
    return this.options.platform;
  }

  /**
   * Create a resolved dependency object.
   */
  private createResolvedDependency(
    packageName: string,
    config: CDNDependency,
    provider: CDNProvider,
    version?: string,
  ): ResolvedDependency {
    return {
      packageName,
      version: version ?? this.extractVersionFromUrl(config.url) ?? 'latest',
      cdnUrl: config.url,
      integrity: config.integrity,
      global: config.global,
      esm: config.esm ?? false,
      provider,
    };
  }

  /**
   * Try to extract version from CDN URL.
   */
  private extractVersionFromUrl(url: string): string | undefined {
    // Match patterns like @1.2.3/ or /1.2.3/ or @1.2.3
    const versionMatch = url.match(/@(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    // Match /vX.Y.Z pattern
    const versionMatch2 = url.match(/\/v?(\d+\.\d+\.\d+)\//);
    if (versionMatch2) {
      return versionMatch2[1];
    }

    return undefined;
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a dependency resolver for a specific platform.
 *
 * @param platform - Target platform
 * @param options - Additional options
 * @returns Configured dependency resolver
 */
export function createResolver(
  platform: CDNPlatformType,
  options?: Omit<DependencyResolverOptions, 'platform'>,
): DependencyResolver {
  return new DependencyResolver({
    platform,
    ...options,
  });
}

/**
 * Create a Claude-compatible resolver.
 *
 * Only uses cdnjs.cloudflare.com for dependencies.
 */
export function createClaudeResolver(options?: Omit<DependencyResolverOptions, 'platform'>): DependencyResolver {
  return createResolver('claude', options);
}

/**
 * Create an OpenAI-compatible resolver.
 *
 * Can use any CDN but prefers Cloudflare.
 */
export function createOpenAIResolver(options?: Omit<DependencyResolverOptions, 'platform'>): DependencyResolver {
  return createResolver('openai', options);
}

/**
 * Resolve dependencies for a source file.
 *
 * Convenience function that creates a resolver and resolves in one call.
 *
 * @param source - Source code
 * @param externals - Package names to resolve from CDN
 * @param options - Resolver options
 * @returns Resolved dependencies
 */
export function resolveDependencies(
  source: string,
  externals: string[],
  options?: DependencyResolverOptions,
): ResolvedDependency[] {
  const resolver = new DependencyResolver(options);
  return resolver.resolveFromSource(source, externals);
}

/**
 * Generate import map for dependencies.
 *
 * Convenience function that resolves and generates import map in one call.
 *
 * @param externals - Package names to include
 * @param options - Resolver options
 * @returns Import map
 */
export function generateImportMapForPackages(externals: string[], options?: DependencyResolverOptions): ImportMap {
  const resolver = new DependencyResolver(options);
  const resolved = resolver.resolveMany(externals);
  return resolver.generateImportMap(resolved);
}
