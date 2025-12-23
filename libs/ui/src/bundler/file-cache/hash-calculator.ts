/**
 * Hash Calculator
 *
 * SHA-256 based hash calculation for cache keys.
 * Combines file contents, dependencies, and build options
 * to create deterministic cache keys for incremental builds.
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

import type { FileBundleOptions, CDNDependency } from '@frontmcp/uipack/dependency';

// ============================================
// Hash Functions
// ============================================

/**
 * Calculate SHA-256 hash of a string.
 *
 * @param content - Content to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Calculate SHA-256 hash of a buffer.
 *
 * @param buffer - Buffer to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculate hash of a file's contents.
 *
 * @param filePath - Path to the file
 * @returns SHA-256 hash or undefined if file doesn't exist
 */
export async function hashFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath);
    return sha256Buffer(content);
  } catch {
    return undefined;
  }
}

/**
 * Calculate combined hash of multiple files.
 *
 * @param filePaths - Paths to files
 * @returns Combined SHA-256 hash
 */
export async function hashFiles(filePaths: string[]): Promise<string> {
  const hashes: string[] = [];

  for (const filePath of filePaths.sort()) {
    const hash = await hashFile(filePath);
    if (hash) {
      hashes.push(`${filePath}:${hash}`);
    }
  }

  return sha256(hashes.join('\n'));
}

// ============================================
// Component Hash Calculation
// ============================================

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
export async function calculateComponentHash(options: ComponentHashOptions): Promise<ComponentHashResult> {
  const {
    entryPath,
    baseDir = dirname(entryPath),
    externals: _externals = [],
    dependencies = {},
    bundleOptions = {},
    maxDepth = 10,
  } = options;

  // Resolve absolute entry path
  const absoluteEntryPath = resolve(entryPath);

  // Collect all local files (entry + dependencies)
  const files = new Set<string>();
  const fileHashes: Record<string, string> = {};

  await collectLocalDependencies(absoluteEntryPath, baseDir, files, maxDepth, 0);

  // Calculate hashes for all files
  for (const file of files) {
    const hash = await hashFile(file);
    if (hash) {
      fileHashes[file] = hash;
    }
  }

  // Sort files for deterministic ordering
  const sortedFiles = Array.from(files).sort();

  // Calculate combined file hash
  const fileHashContent = sortedFiles.map((f) => `${f}:${fileHashes[f] || 'missing'}`).join('\n');
  const filesHash = sha256(fileHashContent);

  // Calculate options hash
  const optionsHash = sha256(JSON.stringify(sortedObject(bundleOptions as Record<string, unknown>)));

  // Calculate dependencies hash
  const dependenciesHash = sha256(JSON.stringify(sortedObject(dependencies as Record<string, unknown>)));

  // Combine all hashes
  const combinedHash = sha256([filesHash, optionsHash, dependenciesHash].join(':'));

  return {
    hash: combinedHash,
    entryHash: fileHashes[absoluteEntryPath] || '',
    files: sortedFiles,
    fileHashes,
    optionsHash,
    dependenciesHash,
  };
}

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
export async function calculateQuickHash(entryPath: string, bundleOptions?: FileBundleOptions): Promise<string> {
  const entryHash = await hashFile(entryPath);
  const optionsHash = bundleOptions
    ? sha256(JSON.stringify(sortedObject(bundleOptions as Record<string, unknown>)))
    : '';

  return sha256(`${entryHash || 'missing'}:${optionsHash}`);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Collect all local dependencies recursively.
 */
async function collectLocalDependencies(
  filePath: string,
  baseDir: string,
  collected: Set<string>,
  maxDepth: number,
  currentDepth: number,
): Promise<void> {
  if (currentDepth >= maxDepth) return;
  if (collected.has(filePath)) return;

  if (!existsSync(filePath)) return;

  collected.add(filePath);

  try {
    const content = await readFile(filePath, 'utf8');
    const imports = extractImportPaths(content);

    for (const importPath of imports) {
      // Skip external packages
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        continue;
      }

      // Resolve the import path
      const resolvedPath = resolveImportPath(importPath, dirname(filePath));
      if (resolvedPath && existsSync(resolvedPath)) {
        await collectLocalDependencies(resolvedPath, baseDir, collected, maxDepth, currentDepth + 1);
      }
    }
  } catch {
    // Ignore unreadable files
  }
}

/**
 * Extract import paths from source code.
 */
function extractImportPaths(source: string): string[] {
  const paths: string[] = [];

  // Match import ... from '...'
  const importRegex = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }

  // Match export ... from '...'
  const exportRegex = /export\s+(?:\*|{[^}]+})\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = exportRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }

  // Match require('...')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }

  // Match dynamic import('...')
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }

  return [...new Set(paths)];
}

/**
 * Resolve an import path to an absolute file path.
 */
function resolveImportPath(importPath: string, fromDir: string): string | undefined {
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  for (const ext of extensions) {
    const fullPath = join(fromDir, importPath + ext);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Try as directory with index file
  for (const ext of extensions) {
    const indexPath = join(fromDir, importPath, `index${ext}`);
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}

/**
 * Create a sorted copy of an object for deterministic JSON serialization.
 */
function sortedObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sorted[key] = sortedObject(value as Record<string, unknown>);
    } else {
      sorted[key] = value;
    }
  }

  return sorted;
}

// ============================================
// Build ID Generation
// ============================================

/**
 * Generate a unique build ID.
 *
 * Combines timestamp and random component for uniqueness.
 *
 * @returns UUID-like build ID
 */
export function generateBuildId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Generate a build ID from a content hash.
 *
 * Creates a shorter, more readable ID while maintaining uniqueness.
 *
 * @param hash - Content hash
 * @returns Shortened build ID
 */
export function buildIdFromHash(hash: string): string {
  // Use first 12 characters of hash
  return hash.substring(0, 12);
}
