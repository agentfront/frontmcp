/**
 * Shell Module
 *
 * HTML shell builder for wrapping UI widget content with
 * CSP, data injection, and bridge runtime.
 *
 * @packageDocumentation
 */

// Types
export type { ShellConfig, ShellResult, CSPConfig } from './types';

// Builder
export { buildShell } from './builder';

// CSP
export {
  DEFAULT_CDN_DOMAINS,
  DEFAULT_CSP_DIRECTIVES,
  RESTRICTIVE_CSP_DIRECTIVES,
  buildCSPDirectives,
  buildCSPMetaTag,
  validateCSPDomain,
  sanitizeCSPDomains,
} from './csp';

// Data Injector
export { buildDataInjectionScript, createTemplateHelpers, type TemplateHelpers } from './data-injector';

// Custom Shell Types
export type {
  ShellPlaceholderName,
  InlineShellSource,
  UrlShellSource,
  NpmShellSource,
  CustomShellSource,
  ShellTemplateValidation,
  ResolvedShellTemplate,
  ShellPlaceholderValues,
} from './custom-shell-types';
export {
  SHELL_PLACEHOLDER_NAMES,
  SHELL_PLACEHOLDERS,
  REQUIRED_PLACEHOLDERS,
  OPTIONAL_PLACEHOLDERS,
  isInlineShellSource,
  isUrlShellSource,
  isNpmShellSource,
} from './custom-shell-types';

// Custom Shell Validator
export { validateShellTemplate } from './custom-shell-validator';

// Custom Shell Applier
export { applyShellTemplate } from './custom-shell-applier';

// Custom Shell Resolver
export { resolveShellTemplate, clearShellTemplateCache } from './custom-shell-resolver';
export type { ResolveShellOptions } from './custom-shell-resolver';
