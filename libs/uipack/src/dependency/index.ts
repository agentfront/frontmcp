/**
 * Dependency Resolution Module
 *
 * Provides CDN dependency resolution, import parsing, and file-based
 * component bundling support for FrontMCP UI widgets.
 *
 * @packageDocumentation
 */

// ============================================
// Types
// ============================================

export {
  // CDN Provider Types
  type CDNProvider,
  type CDNPlatformType,
  type CDNProviderConfig,
  // CDN Dependency
  type CDNDependency,
  // Bundle Options
  type BundleTarget,
  type FileBundleOptions,
  // File Template Config
  type FileTemplateConfig,
  // Import Map
  type ImportMap,
  // Build Cache Types
  type ResolvedDependency,
  type ComponentBuildManifest,
  type BuildCacheStorage,
  type CacheStats,
  // CDN Registry Types
  type CDNRegistryEntry,
  type CDNRegistry,
  // Dependency Resolution
  type DependencyResolverOptions,
  // Parsed Import Types
  type ParsedImport,
  type ParsedImportResult,
  // Template Mode & Format Types
  type TemplateMode,
  type TemplateFormat,
  type TemplateSource,
  type UrlFetchResult,
  type ResolvedTemplate,
  type TemplateProcessingOptions,
  type ProcessedTemplate,
  // Utility Functions
  detectTemplateMode,
  detectFormatFromPath,
} from './types';

// ============================================
// Schemas
// ============================================

export {
  // Provider Schemas
  cdnProviderSchema,
  cdnPlatformTypeSchema,
  // Dependency Schemas
  cdnDependencySchema,
  type CDNDependencyInput,
  type CDNDependencyOutput,
  // Bundle Option Schemas
  bundleTargetSchema,
  fileBundleOptionsSchema,
  type FileBundleOptionsInput,
  type FileBundleOptionsOutput,
  // File Template Schemas
  fileTemplateConfigSchema,
  type FileTemplateConfigInput,
  type FileTemplateConfigOutput,
  // Import Map Schemas
  importMapSchema,
  type ImportMapInput,
  type ImportMapOutput,
  // Resolved Dependency Schemas
  resolvedDependencySchema,
  type ResolvedDependencyInput,
  type ResolvedDependencyOutput,
  // Build Manifest Schemas
  componentBuildManifestSchema,
  buildManifestMetadataSchema,
  buildManifestOutputsSchema,
  type ComponentBuildManifestInput,
  type ComponentBuildManifestOutput,
  // Registry Schemas
  cdnProviderConfigSchema,
  cdnRegistryEntrySchema,
  packageMetadataSchema,
  type CDNRegistryEntryInput,
  type CDNRegistryEntryOutput,
  // Resolver Options Schemas
  dependencyResolverOptionsSchema,
  type DependencyResolverOptionsInput,
  type DependencyResolverOptionsOutput,
  // Parsed Import Schemas
  importTypeSchema,
  parsedImportSchema,
  parsedImportResultSchema,
  type ParsedImportInput,
  type ParsedImportOutput,
  type ParsedImportResultInput,
  type ParsedImportResultOutput,
  // Cache Stats Schema
  cacheStatsSchema,
  type CacheStatsInput,
  type CacheStatsOutput,
  // Validation Helpers
  type SafeParseResult,
  validateCDNDependency,
  safeParseCDNDependency,
  validateFileTemplateConfig,
  safeParseFileTemplateConfig,
  validateBuildManifest,
  safeParseBuildManifest,
} from './schemas';

// ============================================
// CDN Registry
// ============================================

export {
  // Default Registry
  DEFAULT_CDN_REGISTRY,
  // Provider Priority
  CDN_PROVIDER_PRIORITY,
  // Lookup Functions
  lookupPackage,
  getPackageCDNUrl,
  getPackageCDNDependency,
  getRegisteredPackages,
  isPackageRegistered,
  mergeRegistries,
  getPackagePeerDependencies,
  resolveAllDependencies,
} from './cdn-registry';

// ============================================
// Import Parser
// ============================================

export {
  // Parser Functions
  parseImports,
  extractExternalPackages,
  filterImportsByPackages,
  getImportStats,
  getPackageName,
} from './import-parser';

// ============================================
// Dependency Resolver
// ============================================

export {
  // Resolver Class
  DependencyResolver,
  // Factory Functions
  createResolver,
  createClaudeResolver,
  createOpenAIResolver,
  // Convenience Functions
  resolveDependencies,
  generateImportMapForPackages,
  // Errors
  DependencyResolutionError,
  NoProviderError,
} from './resolver';

// ============================================
// Import Map Generator
// ============================================

export {
  // Creation Functions
  createImportMap,
  createImportMapFromOverrides,
  mergeImportMaps,
  addScope,
  // HTML Generation
  generateImportMapScriptTag,
  generateImportMapScriptTagMinified,
  generateUMDShim,
  generateCDNScriptTags,
  generateESMScriptTags,
  generateDependencyHTML,
  // Validation
  validateImportMap,
  // Types
  type UMDShimOptions,
  type DependencyHTMLOptions,
} from './import-map';

// ============================================
// Template Loader
// ============================================

export {
  // Source Detection
  detectTemplateSource,
  isFileBasedTemplate,
  // URL Functions
  validateTemplateUrl,
  detectFormatFromUrl,
  fetchTemplateFromUrl,
  type FetchTemplateOptions,
  // File Functions
  readTemplateFromFile,
  resolveFilePath,
  type ReadTemplateOptions,
  // Main Resolver
  resolveTemplate,
  type ResolveTemplateOptions,
  // Cache Management
  getUrlCache,
  clearUrlCache,
  needsRefetch,
  invalidateUrlCache,
} from './template-loader';

// ============================================
// Import Rewriter
// ============================================

export { rewriteImportsToEsmSh, type RewriteImportsOptions, type RewriteImportsResult } from './import-rewriter';

// ============================================
// Template Processor
// ============================================

export {
  // Main Processing
  processTemplate,
  processTemplates,
  // Format Utilities
  supportsHandlebars,
  producesHtml,
  requiresBundling,
  // Convenience Functions
  processHtmlTemplate,
  processMarkdownTemplate,
  processMdxTemplate,
  // Cache Management
  clearHandlebarsCache,
  // Availability Check
  isMarkedAvailable,
} from './template-processor';
