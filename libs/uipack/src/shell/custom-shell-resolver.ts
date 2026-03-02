/**
 * Custom Shell Template Resolver
 *
 * Resolves custom shell template sources (inline, URL, npm) to
 * validated `ResolvedShellTemplate` objects. URL and npm sources
 * are cached in-memory to avoid redundant fetches.
 *
 * @packageDocumentation
 */

import type { CustomShellSource, ResolvedShellTemplate, NpmShellSource } from './custom-shell-types';
import { isInlineShellSource, isUrlShellSource, isNpmShellSource } from './custom-shell-types';
import { validateShellTemplate } from './custom-shell-validator';
import type { ImportResolver } from '../resolver/types';

/** Default fetch timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 10_000;

/** In-memory cache for resolved templates */
const templateCache = new Map<string, ResolvedShellTemplate>();

/** Options for resolving shell templates */
export interface ResolveShellOptions {
  /** Custom import resolver (for npm sources) */
  resolver?: ImportResolver;
  /** Skip cache lookup and storage */
  noCache?: boolean;
}

/**
 * Resolve a custom shell source to a validated template.
 *
 * - **Inline:** validates immediately and returns
 * - **URL:** fetches with timeout, validates, caches by URL
 * - **NPM:** resolves specifier via ImportResolver → CDN URL, fetches, extracts template string, validates, caches
 *
 * @throws {Error} If the template is missing required placeholders
 * @throws {Error} If the URL fetch fails or times out
 * @throws {Error} If npm resolution fails or template extraction fails
 *
 * @example
 * ```typescript
 * // Inline
 * const resolved = await resolveShellTemplate({ inline: '<html>{{CONTENT}}</html>' });
 *
 * // URL
 * const resolved = await resolveShellTemplate({ url: 'https://example.com/shell.html' });
 *
 * // NPM
 * const resolved = await resolveShellTemplate({ npm: 'my-shell-package' });
 * ```
 */
export async function resolveShellTemplate(
  source: CustomShellSource,
  options?: ResolveShellOptions,
): Promise<ResolvedShellTemplate> {
  if (isInlineShellSource(source)) {
    return resolveInline(source.inline);
  }

  if (isUrlShellSource(source)) {
    const cacheKey = `url:${source.url}`;

    if (!options?.noCache) {
      const cached = templateCache.get(cacheKey);
      if (cached) return cached;
    }

    const template = await fetchWithTimeout(source.url, source.timeout ?? DEFAULT_TIMEOUT_MS);
    const resolved = buildResolved(template, 'url');

    if (!options?.noCache) {
      templateCache.set(cacheKey, resolved);
    }

    return resolved;
  }

  if (isNpmShellSource(source)) {
    const specifier = source.version ? `${source.npm}@${source.version}` : source.npm;
    const cacheKey = `npm:${specifier}`;

    if (!options?.noCache) {
      const cached = templateCache.get(cacheKey);
      if (cached) return cached;
    }

    const template = await resolveNpmTemplate(source, specifier, options?.resolver);
    const resolved = buildResolved(template, 'npm');

    if (!options?.noCache) {
      templateCache.set(cacheKey, resolved);
    }

    return resolved;
  }

  throw new Error('Invalid custom shell source: must have "inline", "url", or "npm" property');
}

/**
 * Clear the in-memory shell template cache.
 */
export function clearShellTemplateCache(): void {
  templateCache.clear();
}

// ============================================
// Internal Helpers
// ============================================

function resolveInline(template: string): ResolvedShellTemplate {
  return buildResolved(template, 'inline');
}

function buildResolved(template: string, sourceType: 'inline' | 'url' | 'npm'): ResolvedShellTemplate {
  const validation = validateShellTemplate(template);

  if (!validation.valid) {
    throw new Error(
      `Custom shell template is missing required placeholder(s): ${validation.missingRequired.map((n) => `{{${n}}}`).join(', ')}`,
    );
  }

  return { template, sourceType, validation };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Failed to fetch shell template from ${url}: HTTP ${response.status}`);
    }

    return await response.text();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Shell template fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveNpmTemplate(
  source: NpmShellSource,
  specifier: string,
  resolver?: ImportResolver,
): Promise<string> {
  // Resolve npm specifier to CDN URL
  const cdnUrl = resolveNpmToCdnUrl(specifier, resolver);

  // Fetch the module text
  const moduleText = await fetchWithTimeout(cdnUrl, DEFAULT_TIMEOUT_MS);

  // Extract template string from the module
  return extractTemplateFromModule(moduleText, source.exportName);
}

function resolveNpmToCdnUrl(specifier: string, resolver?: ImportResolver): string {
  if (resolver) {
    const resolved = resolver.resolve(specifier);
    if (resolved) {
      return resolved.value;
    }
  }

  // Default fallback to esm.sh
  return `https://esm.sh/${specifier}`;
}

/**
 * Extract a template string from a JavaScript module source.
 *
 * Supports:
 * - `export default \`...\``
 * - `export const NAME = \`...\``
 *
 * npm shell packages must export a plain template literal string.
 */
function extractTemplateFromModule(moduleText: string, exportName?: string): string {
  if (exportName && exportName !== 'default') {
    // Named export: export const NAME = `...`
    const namedPattern = new RegExp(
      `export\\s+(?:const|let|var)\\s+${escapeRegExp(exportName)}\\s*=\\s*\`([\\s\\S]*?)\``,
    );
    const namedMatch = moduleText.match(namedPattern);
    if (namedMatch) {
      return namedMatch[1];
    }
    throw new Error(
      `Could not extract named export "${exportName}" from npm shell package. ` +
        'The package must export a template literal string.',
    );
  }

  // Default export: export default `...`
  const defaultPattern = /export\s+default\s+`([\s\S]*?)`/;
  const defaultMatch = moduleText.match(defaultPattern);
  if (defaultMatch) {
    return defaultMatch[1];
  }

  throw new Error(
    'Could not extract default export from npm shell package. ' +
      'The package must export a template literal string (e.g., export default `<html>...</html>`).',
  );
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
