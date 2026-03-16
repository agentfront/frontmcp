// ═══════════════════════════════════════════════════════════════════
// Package Specifier
// ═══════════════════════════════════════════════════════════════════
export {
  parsePackageSpecifier,
  isPackageSpecifier,
  buildEsmShUrl,
  ESM_SH_BASE_URL,
  type ParsedPackageSpecifier,
} from './package-specifier';

// ═══════════════════════════════════════════════════════════════════
// Auth Types
// ═══════════════════════════════════════════════════════════════════
export {
  type EsmRegistryAuth,
  esmRegistryAuthSchema,
  resolveRegistryToken,
  getRegistryUrl,
  DEFAULT_NPM_REGISTRY,
} from './esm-auth.types';

// ═══════════════════════════════════════════════════════════════════
// Semver Utilities
// ═══════════════════════════════════════════════════════════════════
export {
  satisfiesRange,
  maxSatisfying,
  isValidRange,
  isValidVersion,
  compareVersions,
  isNewerVersion,
} from './semver.utils';

// ═══════════════════════════════════════════════════════════════════
// Cache Manager
// ═══════════════════════════════════════════════════════════════════
export { EsmCacheManager, type EsmCacheEntry, type EsmCacheOptions } from './esm-cache';

// ═══════════════════════════════════════════════════════════════════
// Package Manifest
// ═══════════════════════════════════════════════════════════════════
export {
  normalizeEsmExport,
  frontMcpPackageManifestSchema,
  MANIFEST_PRIMITIVE_KEYS,
  type FrontMcpPackageManifest,
  type ManifestPrimitiveKey,
} from './esm-manifest';

// ═══════════════════════════════════════════════════════════════════
// Version Resolution
// ═══════════════════════════════════════════════════════════════════
export { VersionResolver, type VersionResolutionResult, type VersionResolverOptions } from './version-resolver';

// ═══════════════════════════════════════════════════════════════════
// ESM Module Loader
// ═══════════════════════════════════════════════════════════════════
export { EsmModuleLoader, type EsmLoadResult, type EsmModuleLoaderOptions } from './esm-module-loader';

// ═══════════════════════════════════════════════════════════════════
// Version Poller
// ═══════════════════════════════════════════════════════════════════
export { VersionPoller, type VersionPollerOptions, type VersionCheckResult } from './version-poller';

// ═══════════════════════════════════════════════════════════════════
// Factories
// ═══════════════════════════════════════════════════════════════════
export {
  // Context factories
  createEsmToolContextClass,
  createEsmResourceContextClass,
  createEsmPromptContextClass,
  type EsmToolExecuteHandler,
  type EsmResourceReadHandler,
  type EsmPromptExecuteHandler,
  // Record builders
  buildEsmToolRecord,
  buildEsmResourceRecord,
  buildEsmPromptRecord,
  type EsmToolDefinition,
  type EsmResourceDefinition,
  type EsmPromptDefinition,
  // Instance factories
  createEsmToolInstance,
  createEsmResourceInstance,
  createEsmPromptInstance,
} from './factories';
