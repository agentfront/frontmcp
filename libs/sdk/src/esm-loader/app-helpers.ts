/**
 * @file app-helpers.ts
 * @description Unified API for declaring external apps in @FrontMcp({ apps: [...] }).
 *
 * Provides `app.esm()` for loading @App classes from npm packages and
 * `app.remote()` for connecting to external MCP servers.
 *
 * @example
 * ```ts
 * import { FrontMcp, app } from '@frontmcp/sdk';
 *
 * @FrontMcp({
 *   info: { name: 'Gateway', version: '1.0.0' },
 *   apps: [
 *     LocalApp,
 *     app.esm('@acme/tools@^1.0.0', { namespace: 'acme' }),
 *     app.remote('https://api.example.com/mcp', { namespace: 'api' }),
 *   ],
 * })
 * export default class Server {}
 * ```
 */

import { parsePackageSpecifier } from './package-specifier';
import type { RemoteAppMetadata } from '../common/metadata/app.metadata';
import type { EsmAppOptions, RemoteUrlAppOptions } from '../common/metadata/app.metadata';
import type { AppFilterConfig } from '../common/metadata/app-filter.metadata';

export type { EsmAppOptions, RemoteUrlAppOptions } from '../common/metadata/app.metadata';
export type { PackageLoader } from '../common/metadata/app.metadata';
export type { AppFilterConfig, PrimitiveFilterMap } from '../common/metadata/app-filter.metadata';

// ═══════════════════════════════════════════════════════════════════
// APP NAMESPACE
// ═══════════════════════════════════════════════════════════════════

/**
 * Unified namespace for declaring external apps.
 *
 * @example
 * ```ts
 * // Load @App class from npm
 * app.esm('@acme/tools@^1.0.0', { namespace: 'acme' })
 *
 * // Connect to external MCP server
 * app.remote('https://api.example.com/mcp', { namespace: 'api' })
 * ```
 */
export const app = {
  /**
   * Declare an npm package to load at runtime.
   * The package should export an `@App`-decorated class as its default export.
   *
   * @param specifier - npm package specifier (e.g., '@acme/tools@^1.0.0')
   * @param options - Optional per-app overrides
   * @returns A `RemoteAppMetadata` ready for use in `@FrontMcp({ apps: [...] })`
   */
  esm(specifier: string, options?: EsmAppOptions): RemoteAppMetadata {
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
      urlType: 'esm',
      url: specifier,
      namespace: options?.namespace,
      description: options?.description,
      standalone: options?.standalone ?? false,
      filter: options?.filter,
      ...(hasPackageConfig ? { packageConfig } : {}),
    };
  },

  /**
   * Connect to an external MCP server via HTTP.
   * The remote server's tools, resources, and prompts are proxied through your gateway.
   *
   * @param url - MCP server endpoint URL (e.g., 'https://api.example.com/mcp')
   * @param options - Optional per-app overrides
   * @returns A `RemoteAppMetadata` ready for use in `@FrontMcp({ apps: [...] })`
   */
  remote(url: string, options?: RemoteUrlAppOptions): RemoteAppMetadata {
    // Derive name from URL hostname if not provided
    let derivedName: string;
    try {
      const parsed = new URL(url);
      derivedName = parsed.hostname.split('.')[0];
    } catch {
      derivedName = url;
    }

    return {
      name: options?.name ?? derivedName,
      urlType: 'url',
      url,
      namespace: options?.namespace,
      description: options?.description,
      standalone: options?.standalone ?? false,
      transportOptions: options?.transportOptions,
      remoteAuth: options?.remoteAuth,
      refreshInterval: options?.refreshInterval,
      cacheTTL: options?.cacheTTL,
      filter: options?.filter,
    };
  },
} as const;
