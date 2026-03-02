/**
 * Pluggable Import Resolver Types
 *
 * Defines the interface for resolving bare import specifiers to URLs
 * or other loadable expressions. Users can implement custom resolvers
 * or use the built-in esm.sh resolver.
 *
 * @packageDocumentation
 */

/**
 * Context provided to the resolver for platform/version-aware resolution.
 */
export interface ResolveContext {
  /** Target platform (affects CDN selection) */
  platform?: string;
  /** Requested package version */
  version?: string;
}

/**
 * Result of resolving an import specifier.
 */
export interface ResolvedImport {
  /** The resolved URL or expression */
  value: string;
  /** How to load: 'url' = ESM import URL, 'global' = window.X, 'function' = resolver fn call */
  type: 'url' | 'global' | 'function';
  /** Optional integrity hash (SRI) */
  integrity?: string;
}

/**
 * Pluggable import resolver interface.
 *
 * Implement this to control how bare import specifiers are resolved.
 * The default implementation uses esm.sh CDN.
 *
 * @example
 * ```typescript
 * const myResolver: ImportResolver = {
 *   resolve(specifier) {
 *     if (specifier === 'react') {
 *       return { value: 'https://cdn.example.com/react.js', type: 'url' };
 *     }
 *     return null; // fall through to default
 *   }
 * };
 * ```
 */
export interface ImportResolver {
  /** Resolve a bare import specifier to a URL or expression. Return null to skip. */
  resolve(specifier: string, context?: ResolveContext): ResolvedImport | null;
}

/**
 * Options for configuring import resolution behavior.
 */
export interface ResolverOptions {
  /** Custom resolver (overrides default esm.sh) */
  resolver?: ImportResolver;
  /** Packages to skip (keep as bare imports) */
  skipPackages?: string[];
  /** Per-package URL overrides */
  overrides?: Record<string, string>;
}

/**
 * Supported CDN providers for external library hosting.
 */
export type CDNProvider = 'cloudflare' | 'jsdelivr' | 'unpkg' | 'esm.sh' | 'skypack' | 'custom';

/**
 * Configuration for a single CDN dependency.
 */
export interface CDNDependency {
  /** CDN URL for the library (MUST be HTTPS) */
  url: string;
  /** Subresource Integrity hash */
  integrity?: string;
  /** Global variable name (for UMD builds) */
  global?: string;
  /** Named exports */
  exports?: string[];
  /** Whether this is an ES module */
  esm?: boolean;
  /** Cross-origin attribute */
  crossorigin?: 'anonymous' | 'use-credentials';
  /** Peer dependencies (npm package names) */
  peerDependencies?: string[];
}

/**
 * CDN configuration per provider for a package.
 */
export type CDNProviderConfig = Partial<Record<CDNProvider, CDNDependency>>;

/**
 * Entry in the CDN registry for a known package.
 */
export interface CDNRegistryEntry {
  /** NPM package name */
  packageName: string;
  /** Default/recommended version */
  defaultVersion: string;
  /** CDN configurations per provider */
  providers: CDNProviderConfig;
  /** Preferred CDN provider order */
  preferredProviders?: CDNProvider[];
  /** Package metadata */
  metadata?: {
    description?: string;
    homepage?: string;
    license?: string;
  };
}

/**
 * Full CDN registry mapping package names to their CDN configurations.
 */
export type CDNRegistry = Record<string, CDNRegistryEntry>;

/**
 * Browser import map structure.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap
 */
export interface ImportMap {
  /** Module specifier to URL mappings */
  imports: Record<string, string>;
  /** Scoped mappings for specific paths */
  scopes?: Record<string, Record<string, string>>;
  /** Integrity hashes for imported modules */
  integrity?: Record<string, string>;
}

/**
 * Entry for a resolved dependency.
 */
export interface ResolvedDependency {
  /** NPM package name */
  packageName: string;
  /** Resolved version string */
  version: string;
  /** CDN URL for the package */
  cdnUrl: string;
  /** SRI integrity hash */
  integrity?: string;
  /** Global variable name (for UMD) */
  global?: string;
  /** Whether this is an ES module */
  esm: boolean;
  /** CDN provider used */
  provider: CDNProvider;
}

/**
 * A parsed import statement from source code.
 */
export interface ParsedImport {
  /** Full import statement as it appears in source */
  statement: string;
  /** Module specifier (package name or path) */
  specifier: string;
  /** Import type */
  type: 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic';
  /** Named imports */
  namedImports?: string[];
  /** Default import name */
  defaultImport?: string;
  /** Namespace import name */
  namespaceImport?: string;
  /** Line number in source (1-indexed) */
  line: number;
  /** Column number in source (0-indexed) */
  column: number;
}

/**
 * Result of parsing imports from a source file.
 */
export interface ParsedImportResult {
  /** All parsed imports */
  imports: ParsedImport[];
  /** External package imports (npm packages) */
  externalImports: ParsedImport[];
  /** Relative imports (local files) */
  relativeImports: ParsedImport[];
  /** Unique external package names */
  externalPackages: string[];
}

/**
 * Result of rewriting imports.
 */
export interface RewriteImportsResult {
  /** Rewritten source code */
  code: string;
  /** Number of imports rewritten */
  rewrittenCount: number;
  /** Map of original specifiers to resolved URLs */
  rewrites: Map<string, string>;
  /** Packages that used fallback resolution */
  fallbackPackages: string[];
}
