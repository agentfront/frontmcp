/**
 * @file esm.errors.ts
 * @description Error classes for ESM package loading, version resolution, and caching.
 */

import { PublicMcpError, InternalMcpError, MCP_ERROR_CODES } from './mcp.error';

// ═══════════════════════════════════════════════════════════════════
// LOADING ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when loading an ESM package fails.
 */
export class EsmPackageLoadError extends InternalMcpError {
  readonly packageName: string;
  readonly version?: string;
  readonly originalError?: Error;

  constructor(packageName: string, version?: string, originalError?: Error) {
    super(
      `Failed to load ESM package "${packageName}"${version ? `@${version}` : ''}: ${originalError?.message || 'Unknown error'}`,
      'ESM_PACKAGE_LOAD_ERROR',
    );
    this.packageName = packageName;
    this.version = version;
    this.originalError = originalError;
  }
}

// ═══════════════════════════════════════════════════════════════════
// VERSION ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when version resolution against the npm registry fails.
 */
export class EsmVersionResolutionError extends InternalMcpError {
  readonly packageName: string;
  readonly range: string;
  readonly originalError?: Error;

  constructor(packageName: string, range: string, originalError?: Error) {
    super(
      `Failed to resolve version for "${packageName}@${range}": ${originalError?.message || 'Unknown error'}`,
      'ESM_VERSION_RESOLUTION_ERROR',
    );
    this.packageName = packageName;
    this.range = range;
    this.originalError = originalError;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MANIFEST ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when an ESM package's manifest is invalid or missing.
 */
export class EsmManifestInvalidError extends PublicMcpError {
  readonly packageName: string;
  readonly details?: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_PARAMS;

  constructor(packageName: string, details?: string) {
    super(
      `Invalid manifest in ESM package "${packageName}"${details ? `: ${details}` : ''}`,
      'ESM_MANIFEST_INVALID',
      400,
    );
    this.packageName = packageName;
    this.details = details;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CACHE ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when ESM cache operations fail.
 */
export class EsmCacheError extends InternalMcpError {
  readonly operation: string;
  readonly packageName?: string;
  readonly originalError?: Error;

  constructor(operation: string, packageName?: string, originalError?: Error) {
    super(
      `ESM cache ${operation} failed${packageName ? ` for "${packageName}"` : ''}: ${originalError?.message || 'Unknown error'}`,
      'ESM_CACHE_ERROR',
    );
    this.operation = operation;
    this.packageName = packageName;
    this.originalError = originalError;
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTH ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when authentication to a private npm registry fails.
 */
export class EsmRegistryAuthError extends PublicMcpError {
  readonly registryUrl?: string;
  readonly details?: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.UNAUTHORIZED;

  constructor(registryUrl?: string, details?: string) {
    super(
      `Authentication failed for npm registry${registryUrl ? ` at "${registryUrl}"` : ''}${details ? `: ${details}` : ''}`,
      'ESM_REGISTRY_AUTH_ERROR',
      401,
    );
    this.registryUrl = registryUrl;
    this.details = details;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SPECIFIER ERRORS
// ═══════════════════════════════════════════════════════════════════

/**
 * Error thrown when a package specifier string is invalid.
 */
export class EsmInvalidSpecifierError extends PublicMcpError {
  readonly specifier: string;
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_PARAMS;

  constructor(specifier: string) {
    super(`Invalid ESM package specifier: "${specifier}"`, 'ESM_INVALID_SPECIFIER', 400);
    this.specifier = specifier;
  }
}
