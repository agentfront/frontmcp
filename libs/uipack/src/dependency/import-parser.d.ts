/**
 * Import Parser
 *
 * Parses JavaScript/TypeScript source code to extract import statements.
 * Identifies external (npm) vs relative (local) imports.
 *
 * **Known Limitations:**
 * - Regex-based parsing may produce incorrect results for imports inside comments or strings
 * - Multi-line import statements with unusual formatting may not be detected
 * - Template literal imports (e.g., `import(\`${path}\`)`) are not supported
 * - For caching purposes, false positives are preferred over false negatives
 *
 * @packageDocumentation
 */
import type { ParsedImport, ParsedImportResult } from './types';
/**
 * Get the base package name from an import specifier.
 *
 * @example
 * 'lodash' -> 'lodash'
 * 'lodash/debounce' -> 'lodash'
 * '@org/package' -> '@org/package'
 * '@org/package/subpath' -> '@org/package'
 */
export declare function getPackageName(specifier: string): string;
/**
 * Parse all import statements from source code.
 *
 * Extracts named, default, namespace, side-effect, and dynamic imports.
 * Also extracts re-exports that reference external modules.
 *
 * @param source - Source code to parse
 * @returns Parsed import result with categorized imports
 *
 * @example
 * ```typescript
 * const source = `
 *   import React from 'react';
 *   import { useState, useEffect } from 'react';
 *   import * as d3 from 'd3';
 *   import 'chart.js';
 *   import('./lazy-module');
 *   import { helper } from './utils';
 * `;
 *
 * const result = parseImports(source);
 * console.log(result.externalPackages);
 * // ['react', 'd3', 'chart.js', 'lazy-module']
 * ```
 */
export declare function parseImports(source: string): ParsedImportResult;
/**
 * Extract only external package names from source.
 *
 * This is a faster version when you only need package names.
 *
 * @param source - Source code to parse
 * @returns Array of unique external package names
 */
export declare function extractExternalPackages(source: string): string[];
/**
 * Filter imports to only include specified packages.
 *
 * @param result - Parsed import result
 * @param packages - Package names to include
 * @returns Filtered imports
 */
export declare function filterImportsByPackages(result: ParsedImportResult, packages: string[]): ParsedImport[];
/**
 * Get import statistics for a source file.
 *
 * @param source - Source code to analyze
 * @returns Import statistics
 */
export declare function getImportStats(source: string): {
  total: number;
  external: number;
  relative: number;
  byType: Record<string, number>;
  packages: string[];
};
//# sourceMappingURL=import-parser.d.ts.map
