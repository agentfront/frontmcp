/**
 * Custom Shell Template Types
 *
 * Types, constants, and type guards for custom HTML shell templates
 * with placeholder-based injection.
 *
 * @packageDocumentation
 */

// ============================================
// Placeholder Constants
// ============================================

/** All supported placeholder names */
export const SHELL_PLACEHOLDER_NAMES = ['CSP', 'DATA', 'BRIDGE', 'CONTENT', 'TITLE'] as const;

/** Placeholder name type */
export type ShellPlaceholderName = (typeof SHELL_PLACEHOLDER_NAMES)[number];

/** Placeholder tokens as they appear in templates (e.g., `{{CSP}}`) */
export const SHELL_PLACEHOLDERS: Record<ShellPlaceholderName, string> = {
  CSP: '{{CSP}}',
  DATA: '{{DATA}}',
  BRIDGE: '{{BRIDGE}}',
  CONTENT: '{{CONTENT}}',
  TITLE: '{{TITLE}}',
} as const;

/** Placeholders that MUST be present in a custom shell template */
export const REQUIRED_PLACEHOLDERS: readonly ShellPlaceholderName[] = ['CONTENT'];

/** Placeholders that are optional (omitted silently if absent) */
export const OPTIONAL_PLACEHOLDERS: readonly ShellPlaceholderName[] = ['CSP', 'DATA', 'BRIDGE', 'TITLE'];

// ============================================
// Source Types (polymorphic, mirrors UISource pattern)
// ============================================

/** Mode 1: Inline HTML string */
export interface InlineShellSource {
  inline: string;
}

/** Mode 2: Fetch from URL */
export interface UrlShellSource {
  url: string;
  /** Fetch timeout in milliseconds (default: 10000) */
  timeout?: number;
}

/** Mode 3: Load from npm package */
export interface NpmShellSource {
  npm: string;
  /** Named export to use (default: 'default') */
  exportName?: string;
  /** Package version */
  version?: string;
}

/** Union of all custom shell source types */
export type CustomShellSource = InlineShellSource | UrlShellSource | NpmShellSource;

// ============================================
// Type Guards
// ============================================

export function isInlineShellSource(source: CustomShellSource): source is InlineShellSource {
  return typeof source === 'object' && source !== null && 'inline' in source;
}

export function isUrlShellSource(source: CustomShellSource): source is UrlShellSource {
  return typeof source === 'object' && source !== null && 'url' in source;
}

export function isNpmShellSource(source: CustomShellSource): source is NpmShellSource {
  return typeof source === 'object' && source !== null && 'npm' in source;
}

// ============================================
// Validation & Result Types
// ============================================

/** Result of validating a shell template for placeholder presence */
export interface ShellTemplateValidation {
  /** Whether all required placeholders are present */
  valid: boolean;
  /** Map of placeholder name → whether it was found in the template */
  found: Record<ShellPlaceholderName, boolean>;
  /** Required placeholders that are missing */
  missingRequired: ShellPlaceholderName[];
  /** Optional placeholders that are missing */
  missingOptional: ShellPlaceholderName[];
}

/** A resolved and validated shell template ready for use */
export interface ResolvedShellTemplate {
  /** The raw template string with placeholders */
  template: string;
  /** How the template was sourced */
  sourceType: 'inline' | 'url' | 'npm';
  /** Validation result */
  validation: ShellTemplateValidation;
}

// ============================================
// Placeholder Values (for applier)
// ============================================

/** Values to inject into shell template placeholders */
export interface ShellPlaceholderValues {
  /** CSP meta tag HTML */
  csp: string;
  /** Data injection script HTML */
  data: string;
  /** Bridge runtime script HTML */
  bridge: string;
  /** Widget content HTML */
  content: string;
  /** Page title */
  title: string;
}
