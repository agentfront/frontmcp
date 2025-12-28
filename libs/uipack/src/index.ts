/**
 * @frontmcp/uipack
 *
 * Build tools, bundling, and platform adapters for FrontMCP UI development.
 * This package provides the infrastructure for compiling and deploying UI templates.
 *
 * For UI components (HTML and React), theming, and layouts, use @frontmcp/ui.
 *
 * Key features:
 * - Platform-aware adapters (OpenAI, Claude, etc.)
 * - Runtime JSX/TSX transpilation with SWC
 * - Build-time API for pre-compiling UI templates
 * - Template rendering and widget registration
 *
 * ## Usage
 *
 * ```typescript
 * // Import standalone types
 * import type { UITemplateConfig, TemplateContext } from '@frontmcp/uipack/types';
 *
 * // Import platform adapters
 * import { buildUIMeta } from '@frontmcp/uipack/adapters';
 *
 * // Import build-time API
 * import { buildToolUI } from '@frontmcp/uipack/build';
 * ```
 *
 * For UI components and theming, use @frontmcp/ui instead:
 * ```typescript
 * import { card, button, table } from '@frontmcp/ui/components';
 * import { DEFAULT_THEME, createTheme } from '.../theme';
 * ```
 */

// ============================================
// Standalone Types (SDK-independent)
// These are the canonical source for UI configuration types
// ============================================
export * from './types';

// ============================================
// Platform Adapters (SDK-independent)
// ============================================
export {
  type AIPlatformType,
  type UIMetadata,
  type BuildUIMetaOptions,
  type BuildToolDiscoveryMetaOptions,
  buildUIMeta,
  buildToolDiscoveryMeta,
  buildOpenAICSP,
  // Serving mode resolution
  type ResolvedServingMode,
  type ResolveServingModeOptions,
  resolveServingMode,
  isPlatformModeSupported,
  getDefaultServingMode,
  platformUsesStructuredContent,
  platformSupportsWidgets,
  // Response content builder
  type TextContentBlock,
  type BuildToolResponseOptions,
  type ToolResponseContent,
  buildToolResponseContent,
} from './adapters';

// ============================================
// Build-Time API (SDK-independent)
// ============================================
export {
  type BuildTargetPlatform,
  type BuildOptions,
  type BuildResult,
  type MultiBuildOptions,
  type MultiBuildResult,
  type StaticWidgetOptions,
  buildToolUI,
  buildToolUIMulti,
  buildStaticWidget,
  // Hybrid mode data injection
  HYBRID_DATA_PLACEHOLDER,
  HYBRID_INPUT_PLACEHOLDER,
  injectHybridData,
  injectHybridDataFull,
  isHybridShell,
  needsInputInjection,
  getHybridPlaceholders,
  // New Architecture Builders
  type BuildMode,
  type CdnMode,
  type BuilderOptions,
  type BuildToolOptions,
  type StaticBuildResult,
  type HybridBuildResult,
  type InlineBuildResult,
  type BuilderResult,
  type Builder,
  type IStaticBuilder,
  type IHybridBuilder,
  type IInlineBuilder,
  BaseBuilder,
  StaticBuilder,
  HybridBuilder,
  InlineBuilder,
  // esbuild configuration
  DEFAULT_EXTERNALS,
  CDN_URLS,
  createTransformConfig,
  createExternalizedConfig,
  generateCdnScriptTags,
} from './build';

// ============================================
// MCP Bridge Runtime (Tool UI templates)
// ============================================
export {
  // Runtime types
  type ProviderType,
  type DisplayMode,
  type ThemeMode,
  type HostContext,
  type MCPBridge,
  type MCPBridgeExtended,
  type WrapToolUIOptions,
  type OpenAIRuntime,
  type OpenAIUserAgent,
  type SafeAreaInsets,
  // MCP Bridge Runtime
  MCP_BRIDGE_RUNTIME,
  getMCPBridgeScript,
  isMCPBridgeSupported,
  // CSP utilities
  DEFAULT_CDN_DOMAINS,
  DEFAULT_CSP_DIRECTIVES,
  RESTRICTIVE_CSP_DIRECTIVES,
  buildCSPDirectives,
  buildCSPMetaTag,
  validateCSPDomain,
  sanitizeCSPDomains,
  // Wrapper utilities
  type WrapToolUIFullOptions,
  wrapToolUI,
  wrapToolUIMinimal,
  createTemplateHelpers,
  getToolUIMimeType,
  // Sanitizer
  type SanitizerFn,
  type SanitizeOptions,
  REDACTION_TOKENS,
  PII_PATTERNS,
  sanitizeInput,
  createSanitizer,
  detectPII,
  isEmail,
  isPhone,
  isCreditCard,
  isSSN,
  isIPv4,
  detectPIIType,
  redactPIIFromText,
} from './runtime';

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
// Preview Handlers (New Architecture)
// Platform-specific preview generation for
// OpenAI, Claude, and Generic MCP clients
// ============================================
export {
  // Types
  type Platform,
  // Note: AIPlatformType is also exported from ./adapters (canonical source).
  // The preview module re-exports it for convenience. Use either:
  // - import { AIPlatformType } from '@frontmcp/uipack' (from adapters)
  // - import { AIPlatformType } from '@frontmcp/uipack/preview' (re-exported)
  type DiscoveryPreviewOptions,
  type ExecutionPreviewOptions,
  type BuilderMockData,
  type DiscoveryMeta,
  type ExecutionMeta,
  type PreviewHandler,
  type OpenAIMetaFields,
  type ClaudeMetaFields,
  type FrontMCPMetaFields,
  type UIMetaFields,
  // Preview Handlers
  OpenAIPreview,
  ClaudePreview,
  GenericPreview,
  // Factory Functions
  createPreviewHandler,
  detectPlatform as detectPreviewPlatform,
} from './preview';

// ============================================
// Tool Template Builder
// ============================================
export * from './tool-template';

// ============================================
// Base Template (for Tool UI widgets)
// ============================================
export * from './base-template';

// ============================================
// Multi-Framework Renderer System
// ============================================
export * from './renderers';

// ============================================
// Registry Module - Standalone Tool UI Building
// ============================================
export {
  // Core registry
  ToolUIRegistry,
  type RenderOptions,
  type UIRenderResult,
  type CompileStaticWidgetOptions,
  type HybridComponentPayload,
  type BuildHybridComponentPayloadOptions,
  // Template rendering
  renderToolTemplate,
  renderToolTemplateAsync,
  isReactComponent,
  hasUIConfig,
  containsMdxSyntax,
  type RenderTemplateOptions,
  // URI utilities
  UI_RESOURCE_SCHEME,
  isUIResourceUri,
  isStaticWidgetUri,
  parseWidgetUri,
  buildStaticWidgetUri,
  getUIResourceMimeType,
  type ParsedWidgetUri,
} from './registry';

// ============================================
// Dependency Resolution Module
// ============================================
export {
  // Types
  type CDNProvider,
  type CDNPlatformType,
  type CDNDependency,
  type FileBundleOptions,
  type ImportMap,
  type ResolvedDependency,
  type ComponentBuildManifest,
  type CDNRegistryEntry,
  type CDNRegistry,
  type ParsedImport,
  type ParsedImportResult,
  type TemplateMode,
  detectTemplateMode,
  // CDN Registry
  DEFAULT_CDN_REGISTRY,
  lookupPackage,
  getPackageCDNUrl,
  isPackageRegistered,
  // Import Parser
  parseImports,
  extractExternalPackages,
  getPackageName,
  // Dependency Resolver
  DependencyResolver,
  createResolver,
  createClaudeResolver,
  createOpenAIResolver,
  resolveDependencies,
  generateImportMapForPackages,
  // Import Map Generator
  createImportMap,
  generateImportMapScriptTag,
  generateDependencyHTML,
  generateUMDShim,
} from './dependency';

// ============================================
// File-Based Component Caching
// ============================================
export {
  // Component Builder
  ComponentBuilder,
  createFilesystemBuilder,
  createRedisBuilder,
  type ComponentBuildOptions,
  type ComponentBuildResult,
  // Storage
  FilesystemStorage,
  RedisStorage,
  type BuildCacheStorage,
  // Hash Calculator
  sha256,
  calculateComponentHash,
  calculateQuickHash,
  generateBuildId,
} from './bundler/file-cache';

// ============================================
// TypeScript Type Fetching Engine
// ============================================
export {
  // Types
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
  // Constants
  DEFAULT_TYPE_FETCHER_OPTIONS,
  TYPE_CACHE_PREFIX,
  DEFAULT_TYPE_CACHE_TTL,
  // Cache
  type TypeCacheAdapter,
  type TypeCacheOptions,
  DEFAULT_CACHE_OPTIONS as DEFAULT_TYPE_CACHE_OPTIONS,
  MemoryTypeCache,
  globalTypeCache,
  // DTS Parser
  parseDtsImports,
  isRelativeImport,
  getPackageFromSpecifier,
  getSubpathFromSpecifier,
  parseImportStatement,
  combineDtsContents,
  // Type Fetcher
  TypeFetcher,
  createTypeFetcher,
} from './typings';

// ============================================
// Theme System
// ============================================
export * from './theme';

// ============================================
// Validation
// ============================================
export * from './validation';

// ============================================
// Utilities
// ============================================
export * from './utils';

// ============================================
// Styles
// ============================================
export * from './styles';

// ============================================
// Note: UI components are in @frontmcp/ui
// ============================================
// The following are NOT included in uipack (moved to @frontmcp/ui):
// - Components (@frontmcp/ui/components)
// - Layouts (@frontmcp/ui/layouts)
// - Pages (@frontmcp/ui/pages)
// - Widgets (@frontmcp/ui/widgets)
// - Bridge (@frontmcp/ui/bridge)
// - Web Components (@frontmcp/ui/web-components)
// - React Components (@frontmcp/ui/react)
// - React Hooks (@frontmcp/ui/react/hooks)
