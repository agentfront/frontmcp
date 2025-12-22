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
import {
  type TemplateMode,
  type TemplateSource,
  type TemplateFormat,
  type ResolvedTemplate,
  type UrlFetchResult,
} from './types';
/**
 * Get the URL cache (for testing/debugging).
 */
export declare function getUrlCache(): Map<string, UrlFetchResult>;
/**
 * Clear the URL cache.
 */
export declare function clearUrlCache(): void;
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
export declare function detectTemplateSource(template: string): TemplateSource;
/**
 * Check if a template mode is file-based (file or URL).
 */
export declare function isFileBasedTemplate(mode: TemplateMode): boolean;
/**
 * Validate that a URL is allowed for template fetching.
 * Only HTTPS URLs are allowed.
 *
 * @param url - URL to validate
 * @throws Error if URL is not HTTPS
 */
export declare function validateTemplateUrl(url: string): void;
/**
 * Detect template format from a URL.
 *
 * @param url - URL to detect format from
 * @returns Detected template format
 */
export declare function detectFormatFromUrl(url: string): TemplateFormat;
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
export declare function fetchTemplateFromUrl(url: string, options?: FetchTemplateOptions): Promise<UrlFetchResult>;
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
export declare function readTemplateFromFile(filePath: string, options?: ReadTemplateOptions): Promise<string>;
/**
 * Resolve a file path to an absolute path.
 *
 * @param filePath - Relative or absolute file path
 * @param basePath - Base path for resolving relative paths
 * @returns Absolute file path
 */
export declare function resolveFilePath(filePath: string, basePath?: string): string;
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
export declare function resolveTemplate(template: string, options?: ResolveTemplateOptions): Promise<ResolvedTemplate>;
/**
 * Check if a resolved template needs re-fetching based on cache state.
 * Only applicable for URL templates.
 *
 * @param resolved - Previously resolved template
 * @returns true if the template should be re-fetched
 */
export declare function needsRefetch(resolved: ResolvedTemplate): boolean;
/**
 * Invalidate a cached URL template.
 *
 * @param url - URL to invalidate
 * @returns true if the entry was removed
 */
export declare function invalidateUrlCache(url: string): boolean;
//# sourceMappingURL=template-loader.d.ts.map
