/**
 * Resolver Module
 *
 * Pluggable import resolution for bare specifiers.
 * Default resolver uses esm.sh CDN with CDN registry for known packages.
 *
 * @packageDocumentation
 */

// Types
export type {
  ImportResolver,
  ResolveContext,
  ResolvedImport,
  ResolverOptions,
  CDNProvider,
  CDNDependency,
  CDNProviderConfig,
  CDNRegistryEntry,
  CDNRegistry,
  ImportMap,
  ResolvedDependency,
  ParsedImport,
  ParsedImportResult,
  RewriteImportsResult,
} from './types';

// CDN Registry
export {
  DEFAULT_CDN_REGISTRY,
  lookupPackage,
  getPackageCDNUrl,
  getRegisteredPackages,
  isPackageRegistered,
  mergeRegistries,
  getPackagePeerDependencies,
} from './cdn-registry';

// esm.sh Resolver
export { createEsmShResolver, type EsmShResolverOptions } from './esm-sh.resolver';

// Import Parser
export { parseImports, extractExternalPackages, getPackageName } from './import-parser';

// Import Map
export {
  createImportMapFromResolved,
  createImportMap,
  mergeImportMaps,
  generateImportMapScriptTag,
  generateImportMapScriptTagMinified,
  generateCDNScriptTags,
  generateDependencyHTML,
  validateImportMap,
} from './import-map';

// Import Rewriter
export { rewriteImports } from './import-rewriter';
