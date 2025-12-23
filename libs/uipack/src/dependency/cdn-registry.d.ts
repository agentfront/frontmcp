/**
 * CDN Registry
 *
 * Pre-configured CDN URLs for popular npm packages.
 * Maps package names to their CDN URLs for different providers.
 *
 * Priority: cdnjs.cloudflare.com (Claude compatible) > jsdelivr > unpkg > esm.sh
 *
 * @packageDocumentation
 */
import type { CDNRegistry, CDNRegistryEntry, CDNProvider, CDNPlatformType } from './types';
/**
 * Built-in CDN registry for popular packages.
 *
 * This registry provides CDN URLs for common libraries used in UI widgets.
 * Cloudflare CDN (cdnjs.cloudflare.com) is prioritized for Claude compatibility.
 */
export declare const DEFAULT_CDN_REGISTRY: CDNRegistry;
/**
 * CDN provider priority order by platform.
 * Claude only trusts cdnjs.cloudflare.com.
 */
export declare const CDN_PROVIDER_PRIORITY: Record<CDNPlatformType, CDNProvider[]>;
/**
 * Look up a package in the CDN registry.
 *
 * @param packageName - NPM package name
 * @param registry - Registry to search (defaults to DEFAULT_CDN_REGISTRY)
 * @returns Registry entry or undefined
 */
export declare function lookupPackage(packageName: string, registry?: CDNRegistry): CDNRegistryEntry | undefined;
/**
 * Get the CDN URL for a package.
 *
 * Resolves the CDN URL using platform-specific provider priority.
 *
 * @param packageName - NPM package name
 * @param platform - Target platform (affects CDN selection)
 * @param registry - Registry to search (defaults to DEFAULT_CDN_REGISTRY)
 * @returns CDN URL or undefined if not found
 */
export declare function getPackageCDNUrl(
  packageName: string,
  platform?: CDNPlatformType,
  registry?: CDNRegistry,
): string | undefined;
/**
 * Get full CDN dependency configuration for a package.
 *
 * @param packageName - NPM package name
 * @param platform - Target platform
 * @param registry - Registry to search
 * @returns CDN dependency or undefined
 */
export declare function getPackageCDNDependency(
  packageName: string,
  platform?: CDNPlatformType,
  registry?: CDNRegistry,
):
  | {
      provider: CDNProvider;
      dependency: import('./types').CDNDependency;
    }
  | undefined;
/**
 * Get all registered package names.
 *
 * @param registry - Registry to list (defaults to DEFAULT_CDN_REGISTRY)
 * @returns Array of package names
 */
export declare function getRegisteredPackages(registry?: CDNRegistry): string[];
/**
 * Check if a package is in the registry.
 *
 * @param packageName - NPM package name
 * @param registry - Registry to check
 * @returns true if the package is registered
 */
export declare function isPackageRegistered(packageName: string, registry?: CDNRegistry): boolean;
/**
 * Merge custom registry with the default registry.
 *
 * Custom entries override default entries for the same package.
 *
 * @param customRegistry - Custom registry to merge
 * @returns Merged registry
 */
export declare function mergeRegistries(customRegistry: CDNRegistry): CDNRegistry;
/**
 * Get peer dependencies for a package.
 *
 * Returns peer dependencies from the first available provider.
 *
 * @param packageName - NPM package name
 * @param registry - Registry to search
 * @returns Array of peer dependency package names
 */
export declare function getPackagePeerDependencies(packageName: string, registry?: CDNRegistry): string[];
/**
 * Resolve all dependencies including peer dependencies.
 *
 * @param packageNames - Initial package names
 * @param platform - Target platform
 * @param registry - Registry to use
 * @returns Array of all resolved package names (including peers)
 */
export declare function resolveAllDependencies(
  packageNames: string[],
  platform?: CDNPlatformType,
  registry?: CDNRegistry,
): string[];
//# sourceMappingURL=cdn-registry.d.ts.map
