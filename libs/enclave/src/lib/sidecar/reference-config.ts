/**
 * Reference Sidecar Configuration
 *
 * Defines security-level-specific configurations for the reference sidecar.
 * These settings control how large data is handled in the pass-by-reference system.
 *
 * @packageDocumentation
 */

import type { SecurityLevel } from '../types';

/**
 * Configuration for the reference sidecar system
 */
export interface ReferenceConfig {
  /**
   * Maximum total size of all stored references in bytes
   * Prevents memory exhaustion from excessive data storage
   */
  maxTotalSize: number;

  /**
   * Maximum size of a single reference in bytes
   * Prevents individual large allocations
   */
  maxReferenceSize: number;

  /**
   * Threshold in bytes to trigger extraction from source code
   * Strings larger than this are lifted to the sidecar
   */
  extractionThreshold: number;

  /**
   * Maximum expanded size when resolving references for tool calls
   * Prevents predictive expansion attacks
   */
  maxResolvedSize: number;

  /**
   * Whether to allow composite handles from concatenation
   * If false, __safe_concat__ throws when references are detected
   */
  allowComposites: boolean;

  /**
   * Maximum number of references in a single execution
   * Prevents reference flooding attacks
   */
  maxReferenceCount: number;

  /**
   * Maximum depth when resolving nested references
   * Prevents recursive reference bombs
   */
  maxResolutionDepth: number;
}

/**
 * Reference configurations per security level
 *
 * These configurations align with the enclave's security levels
 * and provide appropriate limits for different trust scenarios.
 */
export const REFERENCE_CONFIGS: Record<SecurityLevel, ReferenceConfig> = {
  /**
   * STRICT: Maximum security for untrusted code
   *
   * - Very small limits to prevent any memory-based attacks
   * - No composite handles (references cannot be concatenated)
   * - Aggressive extraction threshold
   */
  STRICT: {
    maxTotalSize: 16 * 1024 * 1024, // 16MB total
    maxReferenceSize: 4 * 1024 * 1024, // 4MB per reference
    extractionThreshold: 64 * 1024, // 64KB extraction threshold
    maxResolvedSize: 8 * 1024 * 1024, // 8MB max resolved
    allowComposites: false, // No concatenation of references
    maxReferenceCount: 50, // Max 50 references
    maxResolutionDepth: 5, // Shallow resolution
  },

  /**
   * SECURE: High security with more headroom
   *
   * - Moderate limits for trusted AI code
   * - No composite handles by default
   * - Standard extraction threshold
   */
  SECURE: {
    maxTotalSize: 64 * 1024 * 1024, // 64MB total
    maxReferenceSize: 16 * 1024 * 1024, // 16MB per reference
    extractionThreshold: 256 * 1024, // 256KB extraction threshold
    maxResolvedSize: 32 * 1024 * 1024, // 32MB max resolved
    allowComposites: false, // No concatenation of references
    maxReferenceCount: 100, // Max 100 references
    maxResolutionDepth: 10, // Moderate resolution depth
  },

  /**
   * STANDARD: Balanced security and functionality
   *
   * - Standard limits for internal tools
   * - Composite handles allowed
   * - Larger extraction threshold
   */
  STANDARD: {
    maxTotalSize: 256 * 1024 * 1024, // 256MB total
    maxReferenceSize: 64 * 1024 * 1024, // 64MB per reference
    extractionThreshold: 1024 * 1024, // 1MB extraction threshold
    maxResolvedSize: 128 * 1024 * 1024, // 128MB max resolved
    allowComposites: true, // Allow concatenation
    maxReferenceCount: 500, // Max 500 references
    maxResolutionDepth: 20, // Deep resolution
  },

  /**
   * PERMISSIVE: Minimal restrictions
   *
   * - Large limits for development/debugging
   * - All features enabled
   * - High extraction threshold
   */
  PERMISSIVE: {
    maxTotalSize: 1024 * 1024 * 1024, // 1GB total
    maxReferenceSize: 256 * 1024 * 1024, // 256MB per reference
    extractionThreshold: 4 * 1024 * 1024, // 4MB extraction threshold
    maxResolvedSize: 512 * 1024 * 1024, // 512MB max resolved
    allowComposites: true, // Allow concatenation
    maxReferenceCount: 1000, // Max 1000 references
    maxResolutionDepth: 50, // Very deep resolution
  },
};

/**
 * Reference ID format constant
 *
 * Reference IDs follow the format: __REF_[UUIDv4]__
 * The __REF_ prefix is protected by ReservedPrefixRule in ast-guard
 */
export const REF_ID_PREFIX = '__REF_';
export const REF_ID_SUFFIX = '__';

/**
 * Regular expression to match reference IDs
 */
export const REF_ID_PATTERN = /^__REF_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__$/i;

/**
 * Check if a string is a reference ID
 */
export function isReferenceId(value: unknown): value is string {
  return typeof value === 'string' && REF_ID_PATTERN.test(value);
}

/**
 * Get reference config for a security level, with optional overrides
 */
export function getReferenceConfig(
  securityLevel: SecurityLevel,
  overrides?: Partial<ReferenceConfig>,
): ReferenceConfig {
  return {
    ...REFERENCE_CONFIGS[securityLevel],
    ...overrides,
  };
}
