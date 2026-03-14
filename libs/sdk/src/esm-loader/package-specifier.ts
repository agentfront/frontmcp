/**
 * @file package-specifier.ts
 * @description Parse npm package specifiers (e.g., '@scope/pkg@^1.0.0') and build esm.sh URLs.
 */

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
 * @throws Error if the specifier is invalid
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
  if (!trimmed) {
    throw new Error('Package specifier cannot be empty');
  }

  const match = PACKAGE_SPECIFIER_RE.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid package specifier: "${trimmed}"`);
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
  options?: { baseUrl?: string; bundle?: boolean },
): string {
  const base = options?.baseUrl ?? ESM_SH_BASE_URL;
  const version = resolvedVersion ?? spec.range;
  const bundle = options?.bundle !== false;

  let url = `${base}/${spec.fullName}@${version}`;
  if (bundle) {
    url += '?bundle';
  }
  return url;
}
