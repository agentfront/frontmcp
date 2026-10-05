/**
 * @file package-specifier.ts
 * @description Parse npm package specifiers (e.g., '@scope/pkg@^1.0.0') and build esm.sh URLs.
 */

import { EsmInvalidSpecifierError } from '../errors/esm.errors';

/**
 * Parsed representation of an npm package specifier.
 */
export interface ParsedPackageSpecifier {
  /** Scope portion, e.g. '@acme' (includes the @) */
  scope?: string;
  /** Package name without scope, e.g. 'mcp-tools' */
  name: string;
  /** Full package name, e.g. '@acme/mcp-tools' */
  fullName: string;
  /** Semver range or tag, e.g. '^1.0.0', 'latest' */
  range: string;
  /** Original input string */
  raw: string;
}

/**
 * Regex for parsing npm package specifiers.
 * Supports: @scope/name@range, @scope/name, name@range, name
 */
const PACKAGE_SPECIFIER_RE = /^(?:(@[a-z0-9-~][a-z0-9-._~]*)\/)?([a-z0-9-~][a-z0-9-._~]*)(?:@(.+))?$/;

/**
 * Parse an npm-style package specifier string into structured parts.
 *
 * @param spec - Package specifier string (e.g., '@acme/mcp-tools@^1.0.0')
 * @returns Parsed specifier with scope, name, range
 * @throws EsmInvalidSpecifierError if the specifier is empty or invalid
 *
 * @example
 * parsePackageSpecifier('@acme/mcp-tools@^1.0.0')
 * // { scope: '@acme', name: 'mcp-tools', fullName: '@acme/mcp-tools', range: '^1.0.0', raw: '@acme/mcp-tools@^1.0.0' }
 *
 * parsePackageSpecifier('my-tools')
 * // { scope: undefined, name: 'my-tools', fullName: 'my-tools', range: 'latest', raw: 'my-tools' }
 */
export function parsePackageSpecifier(spec: string): ParsedPackageSpecifier {
  const trimmed = spec.trim();
  const match = PACKAGE_SPECIFIER_RE.exec(trimmed);
  if (!match) {
    throw new EsmInvalidSpecifierError(trimmed);
  }

  const [, scope, name, range] = match;
  const fullName = scope ? `${scope}/${name}` : name;

  return {
    scope: scope || undefined,
    name,
    fullName,
    range: range || 'latest',
    raw: trimmed,
  };
}

/**
 * Check whether a string looks like a package specifier (starts with @ or contains alphanumeric).
 * Used by normalize functions to distinguish package strings from other string inputs.
 */
export function isPackageSpecifier(value: string): boolean {
  return PACKAGE_SPECIFIER_RE.test(value.trim());
}

/**
 * Default esm.sh CDN base URL.
 */
export const ESM_SH_BASE_URL = 'https://esm.sh';

/**
 * Build an esm.sh CDN URL for a given package specifier.
 *
 * @param spec - Parsed package specifier
 * @param resolvedVersion - Concrete version to pin to (overrides range)
 * @param options - Additional URL options
 * @returns Full esm.sh URL for dynamic import
 *
 * @example
 * buildEsmShUrl(parsePackageSpecifier('@acme/tools@^1.0.0'), '1.2.3')
 * // 'https://esm.sh/@acme/tools@1.2.3?bundle'
 */
export function buildEsmShUrl(
  spec: ParsedPackageSpecifier,
  resolvedVersion?: string,
  options?: { baseUrl?: string; bundle?: boolean; external?: string[] },
): string {
  const base = options?.baseUrl ?? ESM_SH_BASE_URL;
  const version = resolvedVersion ?? spec.range;
  const query: string[] = [];
  if (options?.bundle !== false) query.push('bundle');
  if (options?.external?.length) query.push(`external=${[...options.external].sort().join(',')}`);

  const url = `${base}/${spec.fullName}@${version}`;
  return query.length > 0 ? `${url}?${query.join('&')}` : url;
}

/** The packages an import map remaps: esm.sh leaves their imports bare (`external`) so they can be rewritten. */
export function importMapPackages(importMap: Record<string, string>): string[] {
  return [...new Set(Object.keys(importMap).map((specifier) => specifier.replace(/\/$/, '')))];
}

const IMPORT_SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\2/g;

/**
 * Rewrites the import specifiers of `bundle` that `importMap` names, with import-map semantics:
 * a key matches its exact specifier, and a key ending in `/` also matches every specifier under it.
 */
export function applyImportMap(bundle: string, importMap: Record<string, string>): string {
  const entries = Object.entries(importMap);
  if (entries.length === 0) return bundle;
  const remap = (specifier: string): string => {
    const exact = importMap[specifier];
    if (exact !== undefined) return exact;
    const prefix = entries.find(([key]) => key.endsWith('/') && specifier.startsWith(key));
    return prefix ? `${prefix[1]}${specifier.slice(prefix[0].length)}` : specifier;
  };
  return bundle.replace(
    IMPORT_SPECIFIER_RE,
    (_match, keyword: string, quote: string, specifier: string) => `${keyword}${quote}${remap(specifier)}${quote}`,
  );
}
