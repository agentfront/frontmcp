/**
 * Template Loader
 *
 * Handles loading templates from various sources:
 * - Inline strings
 * - File paths
 * - CDN URLs
 *
 * Supports caching for URL templates with ETag validation.
 *
 * @packageDocumentation
 */

import { promises as fs } from 'fs';
import { resolve as resolvePath, isAbsolute, sep } from 'path';
import {
  detectTemplateMode,
  detectFormatFromPath,
  type TemplateMode,
  type TemplateSource,
  type TemplateFormat,
  type ResolvedTemplate,
  type UrlFetchResult,
} from './types';
import { sha256 } from '../bundler/file-cache/hash-calculator';

// ============================================
// URL Template Cache
// ============================================

/**
 * In-memory cache for URL-fetched templates.
 * Uses URL as key, stores content and ETag for validation.
 */
const urlCache = new Map<string, UrlFetchResult>();

/**
 * Get the URL cache (for testing/debugging).
 */
export function getUrlCache(): Map<string, UrlFetchResult> {
  return urlCache;
}

/**
 * Clear the URL cache.
 */
export function clearUrlCache(): void {
  urlCache.clear();
}

// ============================================
// Template Source Detection
// ============================================

/**
 * Detect the source type of a template string.
 *
 * @param template - Template string (inline content, file path, or URL)
 * @returns TemplateSource discriminated union
 *
 * @example
 * ```typescript
 * detectTemplateSource('https://cdn.example.com/widget.html')
 * // => { type: 'url', url: 'https://cdn.example.com/widget.html' }
 *
 * detectTemplateSource('./widgets/chart.tsx')
 * // => { type: 'file', path: './widgets/chart.tsx' }
 *
 * detectTemplateSource('<div>{{output.data}}</div>')
 * // => { type: 'inline', content: '<div>{{output.data}}</div>' }
 * ```
 */
export function detectTemplateSource(template: string): TemplateSource {
  const mode = detectTemplateMode(template);

  switch (mode) {
    case 'url':
      return { type: 'url', url: template };
    case 'file-path':
      return { type: 'file', path: template };
    case 'inline-string':
    case 'inline-function':
    default:
      return { type: 'inline', content: template };
  }
}

/**
 * Check if a template mode is file-based (file or URL).
 */
export function isFileBasedTemplate(mode: TemplateMode): boolean {
  return mode === 'file-path' || mode === 'url';
}

// ============================================
// URL Validation & Fetching
// ============================================

/**
 * Validate that a URL is allowed for template fetching.
 * Only HTTPS URLs are allowed.
 *
 * @param url - URL to validate
 * @throws Error if URL is not HTTPS
 */
export function validateTemplateUrl(url: string): void {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    throw new Error(`Template URLs must use HTTPS. Got: ${parsed.protocol}`);
  }
}

/**
 * Detect template format from a URL.
 *
 * @param url - URL to detect format from
 * @returns Detected template format
 */
export function detectFormatFromUrl(url: string): TemplateFormat {
  const parsed = new URL(url);
  return detectFormatFromPath(parsed.pathname);
}

/**
 * Options for fetching a template from URL.
 */
export interface FetchTemplateOptions {
  /**
   * Request timeout in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Whether to skip cache and always fetch fresh.
   * @default false
   */
  skipCache?: boolean;

  /**
   * Custom headers to include in the request.
   */
  headers?: Record<string, string>;
}

/**
 * Fetch a template from a URL with ETag caching support.
 *
 * @param url - HTTPS URL to fetch from
 * @param options - Fetch options
 * @returns Fetched content with metadata
 * @throws Error if URL is not HTTPS or fetch fails
 *
 * @example
 * ```typescript
 * const result = await fetchTemplateFromUrl('https://cdn.example.com/widget.html');
 * console.log(result.content); // Template HTML
 * console.log(result.etag);    // "abc123" (for cache validation)
 * ```
 */
export async function fetchTemplateFromUrl(url: string, options: FetchTemplateOptions = {}): Promise<UrlFetchResult> {
  validateTemplateUrl(url);

  const { timeout = 30000, skipCache = false, headers: customHeaders = {} } = options;

  // Check cache first (unless skip requested)
  if (!skipCache) {
    const cached = urlCache.get(url);
    if (cached?.etag) {
      // Use conditional request with ETag
      const headers: HeadersInit = {
        ...customHeaders,
        'If-None-Match': cached.etag,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.status === 304) {
          // Not modified, return cached content
          return cached;
        }

        // Content changed, fetch new
        return await processFetchResponse(url, response);
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Template fetch timed out after ${timeout}ms: ${url}`);
        }
        throw error;
      }
    }
  }

  // No cache or skip cache - do fresh fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: customHeaders,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    return await processFetchResponse(url, response);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Template fetch timed out after ${timeout}ms: ${url}`);
    }
    throw error;
  }
}

/**
 * Process a fetch response and update cache.
 */
async function processFetchResponse(url: string, response: Response): Promise<UrlFetchResult> {
  if (!response.ok) {
    throw new Error(`Failed to fetch template: ${response.status} ${response.statusText} - ${url}`);
  }

  const content = await response.text();
  const etag = response.headers.get('etag') ?? undefined;
  const contentType = response.headers.get('content-type') ?? undefined;

  const result: UrlFetchResult = {
    content,
    etag,
    contentType,
    fetchedAt: new Date().toISOString(),
  };

  // Update cache
  urlCache.set(url, result);

  return result;
}

// ============================================
// File Template Loading
// ============================================

/**
 * Options for reading a template from file.
 */
export interface ReadTemplateOptions {
  /**
   * Base path for resolving relative file paths.
   * @default process.cwd()
   */
  basePath?: string;

  /**
   * File encoding.
   * @default 'utf-8'
   */
  encoding?: BufferEncoding;
}

/**
 * Read a template from a file path.
 *
 * @param filePath - Relative or absolute file path
 * @param options - Read options
 * @returns Template content
 * @throws Error if file cannot be read
 *
 * @example
 * ```typescript
 * const content = await readTemplateFromFile('./widgets/chart.tsx');
 * console.log(content); // File contents
 *
 * const content2 = await readTemplateFromFile('./widgets/chart.tsx', {
 *   basePath: '/app/src',
 * });
 * ```
 */
export async function readTemplateFromFile(filePath: string, options: ReadTemplateOptions = {}): Promise<string> {
  const { basePath = process.cwd(), encoding = 'utf-8' } = options;

  // Resolve to absolute path
  const absolutePath = isAbsolute(filePath) ? filePath : resolvePath(basePath, filePath);

  // Prevent path traversal attacks - ensure resolved path stays within base directory
  const normalizedBase = resolvePath(basePath);
  if (!absolutePath.startsWith(normalizedBase + sep) && absolutePath !== normalizedBase) {
    throw new Error(`Template path escapes base directory: ${filePath}`);
  }

  try {
    return await fs.readFile(absolutePath, encoding);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Template file not found: ${absolutePath}`);
    }
    if (err.code === 'EACCES') {
      throw new Error(`Permission denied reading template file: ${absolutePath}`);
    }
    throw new Error(`Failed to read template file: ${absolutePath} - ${err.message}`);
  }
}

/**
 * Resolve a file path to an absolute path.
 *
 * @param filePath - Relative or absolute file path
 * @param basePath - Base path for resolving relative paths
 * @returns Absolute file path
 */
export function resolveFilePath(filePath: string, basePath: string = process.cwd()): string {
  return isAbsolute(filePath) ? filePath : resolvePath(basePath, filePath);
}

// ============================================
// Main Template Resolver
// ============================================

/**
 * Options for resolving a template.
 */
export interface ResolveTemplateOptions {
  /**
   * Base path for resolving relative file paths.
   * @default process.cwd()
   */
  basePath?: string;

  /**
   * Whether to skip URL cache.
   * @default false
   */
  skipCache?: boolean;

  /**
   * Request timeout for URL fetches in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Override the detected format.
   */
  format?: TemplateFormat;
}

/**
 * Resolve a template from any source (inline, file, or URL).
 *
 * This is the main entry point for loading templates. It:
 * 1. Detects the source type (inline, file, URL)
 * 2. Loads the content from the appropriate source
 * 3. Detects the format from file extension
 * 4. Computes content hash for caching
 *
 * @param template - Template string (inline content, file path, or URL)
 * @param options - Resolution options
 * @returns Resolved template with content and metadata
 *
 * @example
 * ```typescript
 * // Inline template
 * const inline = await resolveTemplate('<div>{{output}}</div>');
 *
 * // File template
 * const file = await resolveTemplate('./widgets/chart.tsx', {
 *   basePath: '/app/src',
 * });
 *
 * // URL template
 * const url = await resolveTemplate('https://cdn.example.com/widget.html');
 * ```
 */
export async function resolveTemplate(
  template: string,
  options: ResolveTemplateOptions = {},
): Promise<ResolvedTemplate> {
  const { basePath = process.cwd(), skipCache = false, timeout = 30000, format: overrideFormat } = options;

  const source = detectTemplateSource(template);

  let content: string;
  let format: TemplateFormat;
  let metadata: ResolvedTemplate['metadata'] = {};

  switch (source.type) {
    case 'inline':
      content = source.content;
      format = overrideFormat ?? 'html'; // Inline defaults to HTML
      break;

    case 'file': {
      const absolutePath = resolveFilePath(source.path, basePath);
      content = await readTemplateFromFile(absolutePath);
      format = overrideFormat ?? detectFormatFromPath(source.path);
      metadata.resolvedPath = absolutePath;
      break;
    }

    case 'url': {
      const fetchResult = await fetchTemplateFromUrl(source.url, {
        skipCache,
        timeout,
      });
      content = fetchResult.content;
      format = overrideFormat ?? detectFormatFromUrl(source.url);
      metadata = {
        fetchedAt: fetchResult.fetchedAt,
        etag: fetchResult.etag,
        contentType: fetchResult.contentType,
      };
      break;
    }
  }

  // Compute content hash
  const hash = sha256(content);

  return {
    source,
    format,
    content,
    hash,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * Default TTL for URL cache entries without ETag support.
 * CDNs that don't provide ETags need a fallback TTL.
 * 5 minutes provides a balance between freshness and reducing unnecessary requests.
 */
const URL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a resolved template needs re-fetching based on cache state.
 * Only applicable for URL templates.
 *
 * @param resolved - Previously resolved template
 * @returns true if the template should be re-fetched
 */
export function needsRefetch(resolved: ResolvedTemplate): boolean {
  if (resolved.source.type !== 'url') {
    return false; // Only URL templates can be re-fetched
  }

  const cached = urlCache.get(resolved.source.url);
  if (!cached) {
    return true; // Not in cache, needs fetch
  }

  // If we have an ETag, we can validate with conditional request
  if (cached.etag) {
    return false;
  }

  // For CDNs without ETag support, use TTL-based fallback
  // Check if the cache entry has expired based on fetchedAt timestamp
  if (cached.fetchedAt) {
    const fetchedTime = new Date(cached.fetchedAt).getTime();
    const age = Date.now() - fetchedTime;
    return age > URL_CACHE_TTL_MS;
  }

  // No ETag and no timestamp - needs refetch
  return true;
}

/**
 * Invalidate a cached URL template.
 *
 * @param url - URL to invalidate
 * @returns true if the entry was removed
 */
export function invalidateUrlCache(url: string): boolean {
  return urlCache.delete(url);
}
