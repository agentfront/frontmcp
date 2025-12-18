/**
 * @frontmcp/ui
 *
 * Comprehensive UI library for FrontMCP applications.
 * Provides theme system, layouts, components, page templates, and widgets
 * for building authentication and authorization UIs across multiple LLM platforms.
 *
 * Key features:
 * - Multi-framework renderer support (HTML, React, MDX)
 * - Platform-aware theming (OpenAI, Claude, etc.)
 * - Runtime JSX/TSX transpilation with SWC
 * - MCP Bridge integration for cross-platform widgets
 * - Standalone types and adapters for external consumers (AgentLink)
 * - Build-time API for pre-compiling UI templates
 *
 * ## Standalone Usage (without @frontmcp/sdk)
 *
 * For external systems like AgentLink that want to use the UI components
 * without the full SDK:
 *
 * ```typescript
 * // Import standalone types
 * import type { UITemplateConfig, TemplateContext } from '@frontmcp/ui/types';
 *
 * // Import platform adapters
 * import { buildUIMeta } from '@frontmcp/ui/adapters';
 *
 * // Import build-time API
 * import { buildToolUI } from '@frontmcp/ui/build';
 *
 * // Import components directly
 * import { card, button, table } from '@frontmcp/ui/components';
 * ```
 */

// ============================================
// Standalone Types (SDK-independent)
// These are the canonical source for UI configuration types
// ============================================
export * from './types';

// ============================================
// Utilities (SDK-independent)
// ============================================
export { safeStringify } from './utils';

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
  // Note: buildOpenAICSP is exported from both adapters and runtime/csp
  // We export from adapters as the canonical source
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
} from './build';

// ============================================
// Core Modules
// ============================================

// Validation system
export * from './validation';

// Theme system
export * from './theme';

// Layout system
export * from './layouts';

// UI Components
export * from './components';

// Page templates
export * from './pages';

// Widgets (OpenAI App SDK, progress, etc.)
export * from './widgets';

// MCP Bridge Runtime (Tool UI templates)
// Note: Excluding types that are now in ./types to avoid duplicates
export {
  // Runtime types that are NOT in ./types
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
  // CSP utilities (excluding buildOpenAICSP which is in adapters)
  DEFAULT_CDN_DOMAINS,
  DEFAULT_CSP_DIRECTIVES,
  RESTRICTIVE_CSP_DIRECTIVES,
  buildCSPDirectives,
  buildCSPMetaTag,
  validateCSPDomain,
  sanitizeCSPDomains,
  // Wrapper utilities (excluding buildOpenAIMeta which is in adapters)
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

// Tool Template Builder
export * from './tool-template';

// Base Template (for Tool UI widgets)
export * from './base-template';

// Multi-Framework Renderer System
export * from './renderers';

// ============================================
// FrontMcpBridge - Multi-Platform Adapter System
// ============================================
// The bridge module provides a unified API for MCP widgets across platforms:
// - OpenAI ChatGPT Apps SDK
// - ext-apps (SEP-1865 protocol)
// - Claude (Anthropic)
// - Gemini (Google)
// - Generic fallback
//
// For full access to the bridge system, import from '@frontmcp/ui/bridge':
// import { FrontMcpBridge, createBridge } from '@frontmcp/ui/bridge';
//
// Core bridge exports are also available here:
export {
  // Core types
  type PlatformAdapter,
  type AdapterCapabilities,
  type BridgeConfig,
  // Bridge class
  FrontMcpBridge,
  createBridge,
  // Registry
  AdapterRegistry,
  defaultRegistry,
  registerAdapter,
  // Runtime script generation
  generateBridgeIIFE,
  generatePlatformBundle,
  UNIVERSAL_BRIDGE_SCRIPT,
  BRIDGE_SCRIPT_TAGS,
} from './bridge';

// ============================================
// Web Components - Custom Elements for React/Vue/HTML
// ============================================
// Web Components wrap the HTML functions as native custom elements
// that work directly in React, Vue, Angular, or plain HTML.
//
// For full access to all web components, import from '@frontmcp/ui/web-components':
// import { registerAllComponents } from '@frontmcp/ui/web-components';
//
// Core web component exports:
export {
  // Registration
  registerAllComponents,
  registerFmcpButton,
  registerFmcpCard,
  registerFmcpAlert,
  registerFmcpBadge,
  registerFmcpInput,
  registerFmcpSelect,
  // Element classes
  FmcpButton,
  FmcpCard,
  FmcpAlert,
  FmcpBadge,
  FmcpInput,
  FmcpSelect,
  // Base class for custom elements
  FmcpElement,
} from './web-components';

// ============================================
// Registry Module - Standalone Tool UI Building
// ============================================
// The registry module provides the ToolUIRegistry class for standalone widget
// compilation and rendering without requiring @frontmcp/sdk.
//
// For full access to the registry system, import from '@frontmcp/ui/registry':
// import { ToolUIRegistry, renderToolTemplateAsync } from '@frontmcp/ui/registry';
//
// Core registry exports:
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
// The dependency module provides CDN dependency resolution, import parsing,
// and file-based component bundling support for FrontMCP UI widgets.
//
// For full access, import from '@frontmcp/ui/dependency':
// import { DependencyResolver, parseImports, DEFAULT_CDN_REGISTRY } from '@frontmcp/ui/dependency';
//
// Core dependency exports:
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
// The file-cache module provides SHA-based caching for file-based
// UI component builds, with filesystem (dev) and Redis (prod) storage.
//
// For full access, import from '@frontmcp/ui/bundler/file-cache':
// import { ComponentBuilder, FilesystemStorage, RedisStorage } from '@frontmcp/ui/bundler/file-cache';
//
// Core file-cache exports:
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
// Universal Renderer Module
// ============================================
// The universal module provides a React-based multi-format renderer
// that can handle HTML, Markdown, React, and MDX content with auto-detection.
//
// For full access, import from '@frontmcp/ui/universal':
// import { UniversalApp, createFrontMCPStore, useFrontMCPStore } from '@frontmcp/ui/universal';
//
// Core universal exports:
export {
  // Types
  type ContentType,
  type UniversalContent,
  type FrontMCPState,
  type FrontMCPStore,
  type RenderContext,
  type ClientRenderer,
  type UniversalAppProps,
  type FrontMCPProviderProps,
  type CDNType,
  type UniversalRuntimeOptions,
  type UniversalRuntimeResult,
  // Store
  createFrontMCPStore,
  getGlobalStore,
  setGlobalStore,
  resetGlobalStore,
  useFrontMCPStore,
  useToolOutput as useUniversalToolOutput,
  useToolInput as useUniversalToolInput,
  useContent,
  useToolName,
  useLoadingState,
  initializeStoreFromWindow,
  // Context
  FrontMCPProvider,
  ComponentsProvider,
  UniversalProvider,
  useFrontMCPContext,
  useComponents,
  withFrontMCP,
  // Renderers
  RendererRegistry,
  rendererRegistry,
  detectRenderer,
  renderContent,
  createContent,
  htmlRenderer,
  safeHtmlRenderer,
  markdownRenderer,
  reactRenderer,
  mdxRenderer,
  // Universal App
  UniversalApp,
  UniversalAppWithProvider,
  LoadingSpinner,
  ErrorDisplay,
  EmptyState,
  // Runtime Builder
  buildUniversalRuntime,
  buildMinimalRuntime,
  // Cached Runtime (Optimized)
  getCachedRuntime,
  clearRuntimeCache,
  getRuntimeCacheStats,
  buildAppScript,
  buildDataInjectionCode,
  buildComponentCode,
  RUNTIME_PLACEHOLDERS,
  type CachedRuntimeOptions,
  type CachedRuntimeResult,
  // Constants
  DEFAULT_FRONTMCP_STATE,
  UNIVERSAL_CDN,
  detectContentType,
} from './universal';

// ============================================
// TypeScript Type Fetching Engine
// ============================================
// The typings module provides TypeScript .d.ts fetching from esm.sh CDN.
// Resolves dependencies recursively and combines them into single outputs.
//
// For full access, import from '@frontmcp/ui/typings':
// import { createTypeFetcher, TypeFetcher } from '@frontmcp/ui/typings';
//
// Core typings exports:
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
