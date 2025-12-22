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
  CDNRegistry,
  DependencyResolverOptions,
  ResolvedDependency,
  ImportMap,
} from './types';
/**
 * Error thrown when a dependency cannot be resolved.
 */
export declare class DependencyResolutionError extends Error {
  readonly packageName: string;
  readonly reason: string;
  constructor(packageName: string, reason: string);
}
/**
 * Error thrown when no CDN provider is available for a package.
 */
export declare class NoProviderError extends DependencyResolutionError {
  readonly platform: CDNPlatformType;
  constructor(packageName: string, platform: CDNPlatformType);
}
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
export declare class DependencyResolver {
  private readonly options;
  private readonly registry;
  constructor(options?: DependencyResolverOptions);
  /**
   * Resolve a single package to its CDN dependency.
   *
   * @param packageName - NPM package name
   * @param override - Optional explicit CDN dependency override
   * @returns Resolved dependency, or null in non-strict mode if package is not found (should be bundled)
   * @throws DependencyResolutionError if package cannot be resolved in strict mode
   */
  resolve(packageName: string, override?: CDNDependency): ResolvedDependency | null;
  /**
   * Resolve multiple packages.
   *
   * @param packageNames - Array of package names
   * @param overrides - Optional explicit overrides for specific packages
   * @returns Array of resolved dependencies (in dependency order)
   */
  resolveMany(packageNames: string[], overrides?: Record<string, CDNDependency>): ResolvedDependency[];
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
  ): ResolvedDependency[];
  /**
   * Generate an import map for resolved dependencies.
   *
   * @param dependencies - Resolved dependencies
   * @returns Browser import map
   */
  generateImportMap(dependencies: ResolvedDependency[]): ImportMap;
  /**
   * Check if a package can be resolved for the current platform.
   *
   * @param packageName - Package name to check
   * @returns true if the package can be resolved
   */
  canResolve(packageName: string): boolean;
  /**
   * Get the resolved CDN URL for a package.
   *
   * @param packageName - Package name
   * @param override - Optional explicit override
   * @returns CDN URL or undefined if cannot resolve
   */
  getUrl(packageName: string, override?: CDNDependency): string | undefined;
  /**
   * Get peer dependencies for a package.
   */
  getPeerDependencies(packageName: string): string[];
  /**
   * Create the current registry (default + custom).
   */
  getRegistry(): CDNRegistry;
  /**
   * Get the current platform.
   */
  getPlatform(): CDNPlatformType;
  /**
   * Create a resolved dependency object.
   */
  private createResolvedDependency;
  /**
   * Try to extract version from CDN URL.
   */
  private extractVersionFromUrl;
}
/**
 * Create a dependency resolver for a specific platform.
 *
 * @param platform - Target platform
 * @param options - Additional options
 * @returns Configured dependency resolver
 */
export declare function createResolver(
  platform: CDNPlatformType,
  options?: Omit<DependencyResolverOptions, 'platform'>,
): DependencyResolver;
/**
 * Create a Claude-compatible resolver.
 *
 * Only uses cdnjs.cloudflare.com for dependencies.
 */
export declare function createClaudeResolver(options?: Omit<DependencyResolverOptions, 'platform'>): DependencyResolver;
/**
 * Create an OpenAI-compatible resolver.
 *
 * Can use any CDN but prefers Cloudflare.
 */
export declare function createOpenAIResolver(options?: Omit<DependencyResolverOptions, 'platform'>): DependencyResolver;
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
export declare function resolveDependencies(
  source: string,
  externals: string[],
  options?: DependencyResolverOptions,
): ResolvedDependency[];
/**
 * Generate import map for dependencies.
 *
 * Convenience function that resolves and generates import map in one call.
 *
 * @param externals - Package names to include
 * @param options - Resolver options
 * @returns Import map
 */
export declare function generateImportMapForPackages(
  externals: string[],
  options?: DependencyResolverOptions,
): ImportMap;
//# sourceMappingURL=resolver.d.ts.map
