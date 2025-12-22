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

// ============================================
// Import Patterns
// ============================================

/**
 * Regular expression patterns for matching different import types.
 */
const IMPORT_PATTERNS = {
  /**
   * Named imports: import { foo, bar } from 'module'
   * Also handles renamed imports: import { foo as f } from 'module'
   */
  named: /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,

  /**
   * Default imports: import foo from 'module'
   */
  default: /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,

  /**
   * Namespace imports: import * as foo from 'module'
   */
  namespace: /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,

  /**
   * Side-effect imports: import 'module'
   */
  sideEffect: /import\s*['"]([^'"]+)['"]/g,

  /**
   * Dynamic imports: import('module') or await import('module')
   */
  dynamic: /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,

  /**
   * Combined default and named: import foo, { bar } from 'module'
   */
  defaultAndNamed: /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,

  /**
   * Combined default and namespace: import foo, * as bar from 'module'
   */
  defaultAndNamespace: /import\s+(\w+)\s*,\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,

  /**
   * Re-exports: export { foo } from 'module'
   */
  reExport: /export\s*\{[^}]+\}\s*from\s*['"]([^'"]+)['"]/g,

  /**
   * Re-export all: export * from 'module'
   */
  reExportAll: /export\s*\*\s*from\s*['"]([^'"]+)['"]/g,
};

// ============================================
// Helper Functions
// ============================================

/**
 * Parse named imports string into individual import names.
 *
 * @example
 * "foo, bar as b, baz" -> ['foo', 'bar', 'baz']
 */
function parseNamedImports(namedString: string): string[] {
  return namedString
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      // Handle "foo as bar" - extract original name
      const asMatch = s.match(/^(\w+)\s+as\s+\w+$/);
      return asMatch ? asMatch[1] : s;
    });
}

/**
 * Check if an import specifier is a relative path (local file).
 */
function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}

/**
 * Check if an import specifier is an npm package (external).
 */
function isExternalImport(specifier: string): boolean {
  return !isRelativeImport(specifier) && !specifier.startsWith('#');
}

/**
 * Get the base package name from an import specifier.
 *
 * @example
 * 'lodash' -> 'lodash'
 * 'lodash/debounce' -> 'lodash'
 * '@org/package' -> '@org/package'
 * '@org/package/subpath' -> '@org/package'
 */
export function getPackageName(specifier: string): string {
  // Handle scoped packages (@org/package)
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return specifier;
  }

  // Regular package
  const firstSlash = specifier.indexOf('/');
  return firstSlash === -1 ? specifier : specifier.slice(0, firstSlash);
}

/**
 * Calculate line number from character position.
 */
function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * Calculate column number from character position.
 */
function getColumnNumber(source: string, index: number): number {
  let column = 0;
  for (let i = index - 1; i >= 0 && source[i] !== '\n'; i--) {
    column++;
  }
  return column;
}

// ============================================
// Main Parser Functions
// ============================================

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
export function parseImports(source: string): ParsedImportResult {
  const imports: ParsedImport[] = [];
  const seenStatements = new Set<string>();

  // Helper to add import without duplicates
  const addImport = (imp: ParsedImport) => {
    const key = `${imp.type}:${imp.specifier}:${imp.statement}`;
    if (!seenStatements.has(key)) {
      seenStatements.add(key);
      imports.push(imp);
    }
  };

  // Parse combined default and named: import foo, { bar } from 'module'
  let match;
  const defaultAndNamedRegex = new RegExp(IMPORT_PATTERNS.defaultAndNamed.source, 'g');
  while ((match = defaultAndNamedRegex.exec(source)) !== null) {
    const [statement, defaultName, namedString, specifier] = match;
    const namedImports = parseNamedImports(namedString);

    addImport({
      statement,
      specifier,
      type: 'default',
      defaultImport: defaultName,
      namedImports,
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse combined default and namespace: import foo, * as bar from 'module'
  const defaultAndNamespaceRegex = new RegExp(IMPORT_PATTERNS.defaultAndNamespace.source, 'g');
  while ((match = defaultAndNamespaceRegex.exec(source)) !== null) {
    const [statement, defaultName, namespaceName, specifier] = match;

    addImport({
      statement,
      specifier,
      type: 'default',
      defaultImport: defaultName,
      namespaceImport: namespaceName,
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse named imports: import { foo } from 'module'
  const namedRegex = new RegExp(IMPORT_PATTERNS.named.source, 'g');
  while ((match = namedRegex.exec(source)) !== null) {
    const [statement, namedString, specifier] = match;
    const namedImports = parseNamedImports(namedString);

    addImport({
      statement,
      specifier,
      type: 'named',
      namedImports,
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse default imports: import foo from 'module'
  // Skip if already matched as combined import
  const defaultRegex = new RegExp(IMPORT_PATTERNS.default.source, 'g');
  while ((match = defaultRegex.exec(source)) !== null) {
    const [statement, defaultName, specifier] = match;

    // Skip if this looks like a combined import (has following comma or brace)
    const afterMatch = source.slice(match.index + match[0].length - specifier.length - 2);
    if (afterMatch.startsWith(',')) continue;

    addImport({
      statement,
      specifier,
      type: 'default',
      defaultImport: defaultName,
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse namespace imports: import * as foo from 'module'
  const namespaceRegex = new RegExp(IMPORT_PATTERNS.namespace.source, 'g');
  while ((match = namespaceRegex.exec(source)) !== null) {
    const [statement, namespaceName, specifier] = match;

    addImport({
      statement,
      specifier,
      type: 'namespace',
      namespaceImport: namespaceName,
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse side-effect imports: import 'module'
  const sideEffectRegex = new RegExp(IMPORT_PATTERNS.sideEffect.source, 'g');
  while ((match = sideEffectRegex.exec(source)) !== null) {
    const [statement, specifier] = match;

    // Skip if this is part of another import pattern (has 'from' before it)
    // 50-char lookback is sufficient to capture the 'from' keyword in typical import statements
    const beforeMatch = source.slice(Math.max(0, match.index - 50), match.index);
    if (beforeMatch.includes('from')) continue;

    addImport({
      statement,
      specifier,
      type: 'side-effect',
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse dynamic imports: import('module')
  const dynamicRegex = new RegExp(IMPORT_PATTERNS.dynamic.source, 'g');
  while ((match = dynamicRegex.exec(source)) !== null) {
    const [statement, specifier] = match;

    addImport({
      statement,
      specifier,
      type: 'dynamic',
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse re-exports: export { foo } from 'module'
  const reExportRegex = new RegExp(IMPORT_PATTERNS.reExport.source, 'g');
  while ((match = reExportRegex.exec(source)) !== null) {
    const [statement, specifier] = match;

    addImport({
      statement,
      specifier,
      type: 'named',
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Parse re-export all: export * from 'module'
  const reExportAllRegex = new RegExp(IMPORT_PATTERNS.reExportAll.source, 'g');
  while ((match = reExportAllRegex.exec(source)) !== null) {
    const [statement, specifier] = match;

    addImport({
      statement,
      specifier,
      type: 'namespace',
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Categorize imports
  const externalImports = imports.filter((imp) => isExternalImport(imp.specifier));
  const relativeImports = imports.filter((imp) => isRelativeImport(imp.specifier));

  // Extract unique external package names
  const externalPackages = [...new Set(externalImports.map((imp) => getPackageName(imp.specifier)))];

  return {
    imports,
    externalImports,
    relativeImports,
    externalPackages,
  };
}

/**
 * Extract only external package names from source.
 *
 * This is a faster version when you only need package names.
 *
 * @param source - Source code to parse
 * @returns Array of unique external package names
 */
export function extractExternalPackages(source: string): string[] {
  const result = parseImports(source);
  return result.externalPackages;
}

/**
 * Filter imports to only include specified packages.
 *
 * @param result - Parsed import result
 * @param packages - Package names to include
 * @returns Filtered imports
 */
export function filterImportsByPackages(result: ParsedImportResult, packages: string[]): ParsedImport[] {
  const packageSet = new Set(packages);
  return result.externalImports.filter((imp) => {
    const pkgName = getPackageName(imp.specifier);
    return packageSet.has(pkgName);
  });
}

/**
 * Get import statistics for a source file.
 *
 * @param source - Source code to analyze
 * @returns Import statistics
 */
export function getImportStats(source: string): {
  total: number;
  external: number;
  relative: number;
  byType: Record<string, number>;
  packages: string[];
} {
  const result = parseImports(source);

  const byType: Record<string, number> = {
    named: 0,
    default: 0,
    namespace: 0,
    'side-effect': 0,
    dynamic: 0,
  };

  for (const imp of result.imports) {
    byType[imp.type] = (byType[imp.type] || 0) + 1;
  }

  return {
    total: result.imports.length,
    external: result.externalImports.length,
    relative: result.relativeImports.length,
    byType,
    packages: result.externalPackages,
  };
}
