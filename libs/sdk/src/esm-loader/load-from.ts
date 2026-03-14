/**
 * @file load-from.ts
 * @description User-facing helper for declaring npm/esm app dependencies.
 *
 * `loadFrom()` is the primary way to declare ESM packages in @FrontMcp({ apps: [...] }).
 * It produces a `RemoteAppMetadata` object with urlType 'npm'.
 */

import { parsePackageSpecifier } from './package-specifier';
import type { PackageLoader, RemoteAppMetadata } from '../common/metadata/app.metadata';

export type { PackageLoader } from '../common/metadata/app.metadata';

/**
 * Options for `loadFrom()` — per-app overrides beyond the package specifier.
 */
export interface LoadFromOptions {
  /** Override the auto-derived app name */
  name?: string;
  /** Namespace prefix for tools, resources, and prompts */
  namespace?: string;
  /** Human-readable description */
  description?: string;
  /** Standalone mode */
  standalone?: boolean | 'includeInParent';
  /** Per-app loader override (takes precedence over gateway-level `loader`) */
  loader?: PackageLoader;
  /** Auto-update configuration for semver-based polling */
  autoUpdate?: { enabled: boolean; intervalMs?: number };
  /** Local cache TTL in milliseconds */
  cacheTTL?: number;
  /** Import map overrides for ESM resolution */
  importMap?: Record<string, string>;
}

/**
 * Declare an npm/ESM package to load at runtime.
 *
 * @param specifier - npm package specifier (e.g., '@acme/tools@^1.0.0')
 * @param options - Optional per-app overrides
 * @returns A `RemoteAppMetadata` ready for use in `@FrontMcp({ apps: [...] })`
 *
 * @example
 * // Simple — inherits gateway loader
 * loadFrom('@acme/tools@^1.0.0')
 *
 * @example
 * // With namespace + options
 * loadFrom('@acme/tools@^1.0.0', {
 *   namespace: 'acme',
 *   autoUpdate: { enabled: true, intervalMs: 5000 },
 *   cacheTTL: 60000,
 * })
 *
 * @example
 * // Per-app loader override
 * loadFrom('@other/pkg@latest', {
 *   loader: { url: 'http://other.corp', token: 'xxx' },
 * })
 */
export function loadFrom(specifier: string, options?: LoadFromOptions): RemoteAppMetadata {
  const parsed = parsePackageSpecifier(specifier);

  const packageConfig: RemoteAppMetadata['packageConfig'] = {};
  let hasPackageConfig = false;

  if (options?.loader) {
    packageConfig.loader = options.loader;
    hasPackageConfig = true;
  }
  if (options?.autoUpdate) {
    packageConfig.autoUpdate = options.autoUpdate;
    hasPackageConfig = true;
  }
  if (options?.cacheTTL !== undefined) {
    packageConfig.cacheTTL = options.cacheTTL;
    hasPackageConfig = true;
  }
  if (options?.importMap) {
    packageConfig.importMap = options.importMap;
    hasPackageConfig = true;
  }

  return {
    name: options?.name ?? parsed.fullName,
    urlType: 'npm',
    url: specifier,
    namespace: options?.namespace,
    description: options?.description,
    standalone: options?.standalone ?? false,
    ...(hasPackageConfig ? { packageConfig } : {}),
  };
}
