/**
 * Hash Calculator
 *
 * SHA-256 based hash calculation for cache keys.
 * Combines file contents, dependencies, and build options
 * to create deterministic cache keys for incremental builds.
 *
 * @packageDocumentation
 */
import type { FileBundleOptions, CDNDependency } from '../../dependency/types';
/**
 * Calculate SHA-256 hash of a string.
 *
 * @param content - Content to hash
 * @returns Hex-encoded SHA-256 hash
 */
export declare function sha256(content: string): string;
/**
 * Calculate SHA-256 hash of a buffer.
 *
 * @param buffer - Buffer to hash
 * @returns Hex-encoded SHA-256 hash
 */
export declare function sha256Buffer(buffer: Buffer): string;
/**
 * Calculate hash of a file's contents.
 *
 * @param filePath - Path to the file
 * @returns SHA-256 hash or undefined if file doesn't exist
 */
export declare function hashFile(filePath: string): Promise<string | undefined>;
/**
 * Calculate combined hash of multiple files.
 *
 * @param filePaths - Paths to files
 * @returns Combined SHA-256 hash
 */
export declare function hashFiles(filePaths: string[]): Promise<string>;
/**
 * Options for calculating a component hash.
 */
export interface ComponentHashOptions {
  /**
   * Entry file path.
   */
  entryPath: string;
  /**
   * Base directory for resolving relative imports.
   * @default dirname(entryPath)
   */
  baseDir?: string;
  /**
   * External packages (excluded from hash).
   */
  externals?: string[];
  /**
   * Explicit CDN dependencies.
   */
  dependencies?: Record<string, CDNDependency>;
  /**
   * Bundle options.
   */
  bundleOptions?: FileBundleOptions;
  /**
   * Maximum depth for following imports.
   * @default 10
   */
  maxDepth?: number;
}
/**
 * Result of component hash calculation.
 */
export interface ComponentHashResult {
  /**
   * Combined SHA-256 hash.
   */
  hash: string;
  /**
   * Entry file hash.
   */
  entryHash: string;
  /**
   * All files included in the hash.
   */
  files: string[];
  /**
   * Individual file hashes.
   */
  fileHashes: Record<string, string>;
  /**
   * Hash of build options.
   */
  optionsHash: string;
  /**
   * Hash of external dependencies configuration.
   */
  dependenciesHash: string;
}
/**
 * Calculate a deterministic hash for a file-based component.
 *
 * The hash includes:
 * - Entry file content
 * - All local dependencies (relative imports)
 * - Bundle options
 * - External dependency configurations
 *
 * External npm packages are NOT included in the hash since they're
 * loaded from CDN and versioned separately.
 *
 * @param options - Hash calculation options
 * @returns Hash result with details
 *
 * @example
 * ```typescript
 * const result = await calculateComponentHash({
 *   entryPath: './src/widgets/chart.tsx',
 *   externals: ['chart.js', 'react'],
 *   bundleOptions: { minify: true },
 * });
 *
 * console.log(result.hash); // '3a7bd...'
 * console.log(result.files); // ['./src/widgets/chart.tsx', './src/widgets/utils.ts']
 * ```
 */
export declare function calculateComponentHash(options: ComponentHashOptions): Promise<ComponentHashResult>;
/**
 * Calculate a quick hash for cache lookup (entry file only).
 *
 * This is faster than full component hash but may miss dependency changes.
 * Use for quick cache existence checks, then verify with full hash.
 *
 * @param entryPath - Entry file path
 * @param bundleOptions - Bundle options
 * @returns Quick hash string
 */
export declare function calculateQuickHash(entryPath: string, bundleOptions?: FileBundleOptions): Promise<string>;
/**
 * Generate a unique build ID.
 *
 * Combines timestamp and random component for uniqueness.
 *
 * @returns UUID-like build ID
 */
export declare function generateBuildId(): string;
/**
 * Generate a build ID from a content hash.
 *
 * Creates a shorter, more readable ID while maintaining uniqueness.
 *
 * @param hash - Content hash
 * @returns Shortened build ID
 */
export declare function buildIdFromHash(hash: string): string;
//# sourceMappingURL=hash-calculator.d.ts.map
