/**
 * @frontmcp/uipack
 *
 * HTML shell builder, pluggable import resolver, and NPM component loader
 * for MCP UI development. React-free core.
 *
 * Key features:
 * - Pluggable import resolution (esm.sh default, custom resolvers)
 * - HTML shell generation with CSP, data injection, bridge runtime
 * - NPM component loading (npm, file, URL, or inline function)
 * - TypeScript type fetching from esm.sh
 *
 * @packageDocumentation
 */

// ============================================
// Standalone Types (SDK-independent)
// ============================================
export * from './types';

// ============================================
// Utilities
// ============================================
export * from './utils';

// ============================================
// Bridge Runtime (IIFE Generator)
// ============================================
export {
  generateBridgeIIFE,
  generatePlatformBundle,
  UNIVERSAL_BRIDGE_SCRIPT,
  BRIDGE_SCRIPT_TAGS,
  type IIFEGeneratorOptions,
} from './bridge-runtime';

// ============================================
// TypeScript Type Fetching Engine
// ============================================
export {
  type TypeFetchResult,
  type TypeFetchError,
  type TypeFetchErrorCode,
  type TypeFetchBatchRequest,
  type TypeFetchBatchResult,
  type TypeCacheEntry,
  type TypeCacheStats,
  type DtsImport,
  type DtsParseResult,
  type TypeFetcherOptions,
  type PackageResolution,
  DEFAULT_TYPE_FETCHER_OPTIONS,
  TYPE_CACHE_PREFIX,
  DEFAULT_TYPE_CACHE_TTL,
  type TypeCacheAdapter,
  type TypeCacheOptions,
  DEFAULT_CACHE_OPTIONS as DEFAULT_TYPE_CACHE_OPTIONS,
  MemoryTypeCache,
  globalTypeCache,
  parseDtsImports,
  isRelativeImport,
  getPackageFromSpecifier,
  getSubpathFromSpecifier,
  parseImportStatement,
  combineDtsContents,
  TypeFetcher,
  createTypeFetcher,
} from './typings';

// ============================================
// Resolver (Pluggable Import Resolution)
// ============================================
export * from './resolver';

// ============================================
// Shell (HTML Shell Builder)
// ============================================
// Note: TemplateHelpers is excluded to avoid collision with types/ui-config.ts
export {
  type ShellConfig,
  type ShellResult,
  type CSPConfig,
  buildShell,
  DEFAULT_CDN_DOMAINS,
  DEFAULT_CSP_DIRECTIVES,
  RESTRICTIVE_CSP_DIRECTIVES,
  buildCSPDirectives,
  buildCSPMetaTag,
  validateCSPDomain,
  sanitizeCSPDomains,
  buildDataInjectionScript,
  createTemplateHelpers,
  // Custom Shell
  type ShellPlaceholderName,
  type InlineShellSource,
  type UrlShellSource,
  type NpmShellSource,
  type CustomShellSource,
  type ShellTemplateValidation,
  type ResolvedShellTemplate,
  type ShellPlaceholderValues,
  type ResolveShellOptions,
  SHELL_PLACEHOLDER_NAMES,
  SHELL_PLACEHOLDERS,
  REQUIRED_PLACEHOLDERS,
  OPTIONAL_PLACEHOLDERS,
  isInlineShellSource,
  isUrlShellSource,
  isNpmShellSource,
  validateShellTemplate,
  applyShellTemplate,
  resolveShellTemplate,
  clearShellTemplateCache,
} from './shell';

// ============================================
// Component (NPM Component Loader)
// ============================================
export * from './component';
