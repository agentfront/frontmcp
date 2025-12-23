/**
 * TypeScript Type Fetcher
 *
 * Fetches TypeScript .d.ts files from esm.sh CDN based on import statements.
 * Resolves dependencies recursively and combines them into a single output.
 *
 * @packageDocumentation
 */

import type {
  TypeFetchResult,
  TypeFetchError,
  TypeFetchErrorCode,
  TypeFetchBatchRequest,
  TypeFetchBatchResult,
  TypeFetcherOptions,
  PackageResolution,
  TypeCacheEntry,
  TypeFile,
} from './types';
import { TYPE_CACHE_PREFIX } from './types';
import type { TypeCacheAdapter } from './cache';
import { globalTypeCache } from './cache';
import {
  parseDtsImports,
  parseImportStatement,
  getPackageFromSpecifier,
  getSubpathFromSpecifier,
  combineDtsContents,
} from './dts-parser';

// ============================================
// Semaphore for Concurrency Control
// ============================================

/**
 * Simple semaphore for limiting concurrent operations.
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next?.();
    } else {
      this.permits++;
    }
  }
}

// ============================================
// Type Fetcher Class
// ============================================

/**
 * TypeScript type fetcher for esm.sh CDN.
 *
 * Fetches .d.ts files based on import statements, resolves dependencies
 * recursively, and combines them into single outputs per import.
 *
 * @example
 * ```typescript
 * const fetcher = new TypeFetcher({
 *   maxDepth: 2,
 *   timeout: 10000,
 *   maxConcurrency: 5,
 * });
 *
 * const result = await fetcher.fetchBatch({
 *   imports: [
 *     'import { Card } from "@frontmcp/ui/react"',
 *     'import React from "react"',
 *   ],
 * });
 *
 * console.log(result.results[0].content); // Combined .d.ts for @frontmcp/ui
 * ```
 */
export class TypeFetcher {
  private readonly maxDepth: number;
  private readonly timeout: number;
  private readonly maxConcurrency: number;
  private readonly cdnBaseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly cache: TypeCacheAdapter;

  constructor(options: TypeFetcherOptions = {}, cache?: TypeCacheAdapter) {
    this.maxDepth = options.maxDepth ?? 2;
    this.timeout = options.timeout ?? 10000;
    this.maxConcurrency = options.maxConcurrency ?? 5;
    this.cdnBaseUrl = options.cdnBaseUrl ?? 'https://esm.sh';
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.cache = cache ?? globalTypeCache;
  }

  /**
   * Fetch types for a batch of import statements.
   *
   * @param request - Batch request configuration
   * @returns Batch result with results and errors
   */
  async fetchBatch(request: TypeFetchBatchRequest): Promise<TypeFetchBatchResult> {
    const startTime = Date.now();
    const results: TypeFetchResult[] = [];
    const errors: TypeFetchError[] = [];
    let cacheHits = 0;
    let networkRequests = 0;

    const maxDepth = request.maxDepth ?? this.maxDepth;
    const timeout = request.timeout ?? this.timeout;
    const maxConcurrency = request.maxConcurrency ?? this.maxConcurrency;
    const skipCache = request.skipCache ?? false;
    const versionOverrides = request.versionOverrides ?? {};

    const semaphore = new Semaphore(maxConcurrency);

    // Process imports in parallel
    const promises = request.imports.map(async (importStatement) => {
      await semaphore.acquire();
      try {
        // Parse the import statement to get specifier
        const specifier = parseImportStatement(importStatement);
        if (!specifier) {
          errors.push({
            specifier: importStatement,
            code: 'INVALID_SPECIFIER',
            message: `Could not parse import statement: ${importStatement}`,
          });
          return;
        }

        // Check cache first
        const packageName = getPackageFromSpecifier(specifier);
        const version = versionOverrides[packageName] ?? 'latest';
        const cacheKey = `${TYPE_CACHE_PREFIX}${packageName}@${version}`;

        if (!skipCache) {
          const cached = await this.cache.get(cacheKey);
          if (cached) {
            cacheHits++;
            results.push(cached.result);
            return;
          }
        }

        // Fetch types
        const result = await this.fetchTypesForSpecifier(specifier, {
          maxDepth,
          timeout,
          version,
        });

        if (result.success) {
          results.push(result.data);
          networkRequests += result.fetchCount;

          // Cache the result
          const entry: TypeCacheEntry = {
            result: result.data,
            cachedAt: Date.now(),
            size: result.data.content.length,
            accessCount: 1,
          };
          await this.cache.set(cacheKey, entry);
        } else {
          errors.push(result.error);
          networkRequests += result.fetchCount;
        }
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);

    return {
      results,
      errors,
      totalTimeMs: Date.now() - startTime,
      cacheHits,
      networkRequests,
    };
  }

  /**
   * Fetch types for a single import specifier.
   */
  private async fetchTypesForSpecifier(
    specifier: string,
    options: { maxDepth: number; timeout: number; version: string },
  ): Promise<
    | { success: true; data: TypeFetchResult; fetchCount: number }
    | { success: false; error: TypeFetchError; fetchCount: number }
  > {
    let fetchCount = 0;
    const fetchedUrls: string[] = [];
    const visitedUrls = new Set<string>();
    const contents = new Map<string, string>();

    try {
      // Resolve the package with path fallback
      const resolution = await this.resolvePackage(specifier, options.version, options.timeout);
      if (!resolution) {
        return {
          success: false,
          error: {
            specifier,
            code: 'PACKAGE_NOT_FOUND',
            message: `Could not resolve package: ${specifier}`,
          },
          fetchCount,
        };
      }

      fetchCount++;

      // Fetch the types recursively
      const fetchResult = await this.fetchRecursive(
        resolution.typesUrl,
        options.maxDepth,
        options.timeout,
        visitedUrls,
        contents,
      );

      fetchCount += fetchResult.fetchCount;
      fetchedUrls.push(...fetchResult.fetchedUrls);

      if (!fetchResult.success) {
        return {
          success: false,
          error: {
            specifier,
            code: fetchResult.errorCode as TypeFetchErrorCode,
            message: fetchResult.errorMessage ?? 'Unknown error',
            url: fetchResult.errorUrl,
          },
          fetchCount,
        };
      }

      // Build individual files array for browser editors
      const files = buildTypeFiles(contents, resolution.packageName, resolution.version, resolution.subpath);

      // Combine all fetched contents (deprecated, kept for backwards compatibility)
      const combinedContent = combineDtsContents(contents);

      const result: TypeFetchResult = {
        specifier,
        resolvedPackage: resolution.packageName,
        subpath: resolution.subpath,
        version: resolution.version,
        content: combinedContent,
        files,
        fetchedUrls,
        fetchedAt: new Date().toISOString(),
      };

      return { success: true, data: result, fetchCount };
    } catch (error) {
      return {
        success: false,
        error: {
          specifier,
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        fetchCount,
      };
    }
  }

  /**
   * Resolve a package specifier to a types URL.
   * Uses path fallback: try full path, then remove last segment until found.
   */
  private async resolvePackage(specifier: string, version: string, timeout: number): Promise<PackageResolution | null> {
    const packageName = getPackageFromSpecifier(specifier);
    const subpath = getSubpathFromSpecifier(specifier);

    // Build the URL with version
    const versionSuffix = version === 'latest' ? '' : `@${version}`;
    const baseUrl = `${this.cdnBaseUrl}/${packageName}${versionSuffix}`;

    // If there's a subpath, try with subpath first, then without
    const urlsToTry = subpath ? [`${baseUrl}/${subpath}`, baseUrl] : [baseUrl];

    for (const url of urlsToTry) {
      try {
        const response = await this.fetchWithTimeout(url, timeout, 'HEAD');

        if (response.ok) {
          // Check for X-TypeScript-Types header
          const typesHeader = response.headers.get('X-TypeScript-Types');
          if (typesHeader) {
            // Resolve the types URL (may be relative)
            const typesUrl = typesHeader.startsWith('/') ? `${this.cdnBaseUrl}${typesHeader}` : typesHeader;

            // Extract version from the types URL if available
            const versionMatch = /@(\d+\.\d+\.\d+[^/]*)/.exec(typesUrl);
            const resolvedVersion = versionMatch ? versionMatch[1] : version;

            return {
              packageName,
              subpath,
              version: resolvedVersion,
              typesUrl,
            };
          }
        }
      } catch {
        // Try next URL
        continue;
      }
    }

    return null;
  }

  /**
   * Recursively fetch .d.ts files.
   */
  private async fetchRecursive(
    url: string,
    depth: number,
    timeout: number,
    visited: Set<string>,
    contents: Map<string, string>,
  ): Promise<{
    success: boolean;
    fetchCount: number;
    fetchedUrls: string[];
    errorCode?: string;
    errorMessage?: string;
    errorUrl?: string;
  }> {
    // Prevent loops
    if (visited.has(url)) {
      return { success: true, fetchCount: 0, fetchedUrls: [] };
    }
    visited.add(url);

    let fetchCount = 1;
    const fetchedUrls = [url];

    try {
      const response = await this.fetchWithTimeout(url, timeout, 'GET');

      if (!response.ok) {
        return {
          success: false,
          fetchCount,
          fetchedUrls,
          errorCode: 'NETWORK_ERROR',
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
          errorUrl: url,
        };
      }

      const content = await response.text();
      contents.set(url, content);

      // Stop if max depth reached
      if (depth <= 0) {
        return { success: true, fetchCount, fetchedUrls };
      }

      // Parse for dependencies
      const parsed = parseDtsImports(content);

      // Fetch external packages (but skip built-in types like @types/node)
      for (const pkg of parsed.externalPackages) {
        // Skip @types packages and built-in modules
        if (pkg.startsWith('@types/') || isBuiltinModule(pkg)) {
          continue;
        }

        // Resolve and fetch the dependency
        const resolution = await this.resolvePackage(pkg, 'latest', timeout);
        fetchCount++;

        if (resolution && !visited.has(resolution.typesUrl)) {
          const result = await this.fetchRecursive(resolution.typesUrl, depth - 1, timeout, visited, contents);
          fetchCount += result.fetchCount;
          fetchedUrls.push(...result.fetchedUrls);

          // Continue even if a dependency fails
        }
      }

      // Fetch relative imports
      for (const relativePath of parsed.relativeImports) {
        const resolvedUrl = resolveRelativeUrl(url, relativePath);
        if (resolvedUrl && !visited.has(resolvedUrl)) {
          const result = await this.fetchRecursive(resolvedUrl, depth - 1, timeout, visited, contents);
          fetchCount += result.fetchCount;
          fetchedUrls.push(...result.fetchedUrls);
        }
      }

      return { success: true, fetchCount, fetchedUrls };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timeout');
      return {
        success: false,
        fetchCount,
        fetchedUrls,
        errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorUrl: url,
      };
    }
  }

  /**
   * Fetch with timeout support.
   */
  private async fetchWithTimeout(url: string, timeout: number, method: 'GET' | 'HEAD'): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.fetchFn(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/typescript, text/plain, */*',
        },
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if a module is a Node.js built-in.
 */
function isBuiltinModule(name: string): boolean {
  const builtins = new Set([
    'assert',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'https',
    'module',
    'net',
    'os',
    'path',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'sys',
    'timers',
    'tls',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'zlib',
    // Node.js prefixed modules
    'node:assert',
    'node:buffer',
    'node:child_process',
    'node:cluster',
    'node:console',
    'node:constants',
    'node:crypto',
    'node:dgram',
    'node:dns',
    'node:domain',
    'node:events',
    'node:fs',
    'node:http',
    'node:https',
    'node:module',
    'node:net',
    'node:os',
    'node:path',
    'node:punycode',
    'node:querystring',
    'node:readline',
    'node:repl',
    'node:stream',
    'node:string_decoder',
    'node:sys',
    'node:timers',
    'node:tls',
    'node:tty',
    'node:url',
    'node:util',
    'node:v8',
    'node:vm',
    'node:zlib',
  ]);

  return builtins.has(name);
}

/**
 * Resolve a relative URL against a base URL.
 */
function resolveRelativeUrl(base: string, relative: string): string | null {
  try {
    // Ensure the relative path ends with .d.ts
    let path = relative;
    if (!path.endsWith('.d.ts') && !path.endsWith('.ts')) {
      path = `${path}.d.ts`;
    }

    const resolved = new URL(path, base);
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Build TypeFile array from fetched contents.
 * Converts URLs to virtual file paths for browser editor compatibility.
 * Creates alias entry points for subpath imports.
 *
 * @param contents - Map of URL to .d.ts content
 * @param packageName - The resolved package name
 * @param version - The package version
 * @param subpath - Optional subpath from the original specifier
 * @returns Array of TypeFile objects with virtual paths
 */
export function buildTypeFiles(
  contents: Map<string, string>,
  packageName: string,
  version: string,
  subpath?: string,
): TypeFile[] {
  const files: TypeFile[] = [];

  for (const [url, content] of contents.entries()) {
    const virtualPath = urlToVirtualPath(url, packageName, version);
    files.push({
      path: virtualPath,
      url,
      content,
    });
  }

  // Create alias entry point for subpath imports
  // This allows editors to resolve imports like "@frontmcp/ui/react" correctly
  if (subpath) {
    const aliasPath = `node_modules/${packageName}/${subpath}/index.d.ts`;
    // Check if this path already exists in files
    const aliasExists = files.some((f) => f.path === aliasPath);

    if (!aliasExists) {
      // Create re-export alias that points to the package root
      const aliasContent = `// Auto-generated alias for ${packageName}/${subpath}
export * from '${getRelativeImportPath(subpath)}';
`;
      files.push({
        path: aliasPath,
        url: '', // No actual URL - this is synthesized
        content: aliasContent,
      });
    }
  }

  return files;
}

/**
 * Calculate relative import path from subpath to package root.
 *
 * @param subpath - The subpath within the package
 * @returns Relative import path to the package root index
 *
 * @example
 * getRelativeImportPath('react') // '../index'
 * getRelativeImportPath('components/button') // '../../index'
 */
export function getRelativeImportPath(subpath: string): string {
  const depth = subpath.split('/').length;
  const prefix = '../'.repeat(depth);
  return `${prefix}index`;
}

/**
 * Convert a CDN URL to a virtual file path for browser editors.
 *
 * Examples:
 * - https://esm.sh/v135/zod@3.23.8/lib/types.d.ts -> node_modules/zod/lib/types.d.ts
 * - https://esm.sh/v135/@frontmcp/ui@1.0.0/react/index.d.ts -> node_modules/@frontmcp/ui/react/index.d.ts
 *
 * @param url - The CDN URL
 * @param packageName - The package name (e.g., 'zod', '@frontmcp/ui')
 * @param version - The package version
 * @returns Virtual file path
 */
export function urlToVirtualPath(url: string, packageName: string, version: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Remove /v{number}/ prefix from esm.sh URLs
    const cleanPath = pathname.replace(/^\/v\d+\//, '/');

    // Find where the package@version starts
    const versionedPackage = `${packageName}@${version}`;
    const packageIndex = cleanPath.indexOf(versionedPackage);

    if (packageIndex !== -1) {
      // Extract the path after package@version
      const afterPackageVersion = cleanPath.substring(packageIndex + versionedPackage.length);
      // Build virtual path: node_modules/packageName/...
      const relativePath = afterPackageVersion.startsWith('/') ? afterPackageVersion.substring(1) : afterPackageVersion;
      return `node_modules/${packageName}/${relativePath || 'index.d.ts'}`;
    }

    // Fallback: try to extract path from URL pattern
    // Handle URLs like /packageName@version/path/to/file.d.ts
    const packagePattern = new RegExp(`/${escapeRegExp(packageName)}@[^/]+(/.*)?$`);
    const match = pathname.match(packagePattern);

    if (match) {
      const filePath = match[1] ? match[1].substring(1) : 'index.d.ts';
      return `node_modules/${packageName}/${filePath}`;
    }

    // Last fallback: just use the URL pathname
    return `node_modules/${packageName}/${pathname.split('/').pop() || 'index.d.ts'}`;
  } catch {
    // If URL parsing fails, return a basic path
    return `node_modules/${packageName}/index.d.ts`;
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new TypeFetcher instance.
 *
 * @param options - Fetcher configuration
 * @param cache - Optional custom cache adapter
 * @returns TypeFetcher instance
 *
 * @example
 * ```typescript
 * const fetcher = createTypeFetcher({
 *   maxDepth: 2,
 *   timeout: 10000,
 *   maxConcurrency: 5,
 * });
 *
 * const result = await fetcher.fetchBatch({
 *   imports: ['import React from "react"'],
 * });
 * ```
 */
export function createTypeFetcher(options?: TypeFetcherOptions, cache?: TypeCacheAdapter): TypeFetcher {
  return new TypeFetcher(options, cache);
}
