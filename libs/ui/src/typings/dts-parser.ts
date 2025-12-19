/**
 * .d.ts File Parser
 *
 * Parses TypeScript declaration files to extract imports, exports,
 * and triple-slash references for recursive dependency resolution.
 *
 * @packageDocumentation
 */

import type { DtsImport, DtsParseResult } from './types';

// ============================================
// Regex Patterns
// ============================================

/**
 * Pattern for import statements.
 * Matches: import { X } from 'module', import X from 'module', import 'module', import type { X } from 'module'
 */
const IMPORT_PATTERN = /^import\s+(?:type\s+)?(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/gm;

/**
 * Pattern for export statements with from clause.
 * Matches: export { X } from 'module', export * from 'module'
 */
const EXPORT_FROM_PATTERN = /^export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/gm;

/**
 * Pattern for triple-slash reference types.
 * Matches: /// <reference types="module" />
 */
const REFERENCE_TYPES_PATTERN = /^\/\/\/\s*<reference\s+types\s*=\s*['"]([^'"]+)['"]\s*\/>/gm;

/**
 * Pattern for triple-slash reference path.
 * Matches: /// <reference path="./file.d.ts" />
 */
const REFERENCE_PATH_PATTERN = /^\/\/\/\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]\s*\/>/gm;

/**
 * Pattern for declare module statements.
 * Matches: declare module 'module-name'
 */
const DECLARE_MODULE_PATTERN = /^declare\s+module\s+['"]([^'"]+)['"]/gm;

// ============================================
// Parser Functions
// ============================================

/**
 * Parse a .d.ts file to extract imports, exports, and references.
 *
 * @param content - The .d.ts file content
 * @returns Parsed imports and dependencies
 *
 * @example
 * ```typescript
 * const content = `
 *   import { FC } from 'react';
 *   export { Card } from './components';
 *   /// <reference types="node" />
 * `;
 *
 * const result = parseDtsImports(content);
 * // result.externalPackages = ['react', 'node']
 * // result.relativeImports = ['./components']
 * ```
 */
export function parseDtsImports(content: string): DtsParseResult {
  const imports: DtsImport[] = [];
  const externalPackages = new Set<string>();
  const relativeImports = new Set<string>();

  // Split content into lines for line number tracking
  const lines = content.split('\n');

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check import statements
    IMPORT_PATTERN.lastIndex = 0;
    let match = IMPORT_PATTERN.exec(line);
    if (match) {
      const specifier = match[1];
      imports.push({
        type: 'import',
        specifier,
        statement: line.trim(),
        line: lineNum,
      });
      categorizeSpecifier(specifier, externalPackages, relativeImports);
    }

    // Check export from statements
    EXPORT_FROM_PATTERN.lastIndex = 0;
    match = EXPORT_FROM_PATTERN.exec(line);
    if (match) {
      const specifier = match[1];
      imports.push({
        type: 'export',
        specifier,
        statement: line.trim(),
        line: lineNum,
      });
      categorizeSpecifier(specifier, externalPackages, relativeImports);
    }

    // Check reference types
    REFERENCE_TYPES_PATTERN.lastIndex = 0;
    match = REFERENCE_TYPES_PATTERN.exec(line);
    if (match) {
      const specifier = match[1];
      imports.push({
        type: 'reference',
        specifier,
        statement: line.trim(),
        line: lineNum,
      });
      // Reference types are always external packages
      externalPackages.add(getPackageFromSpecifier(specifier));
    }

    // Check reference paths
    REFERENCE_PATH_PATTERN.lastIndex = 0;
    match = REFERENCE_PATH_PATTERN.exec(line);
    if (match) {
      const specifier = match[1];
      imports.push({
        type: 'reference',
        specifier,
        statement: line.trim(),
        line: lineNum,
      });
      // Reference paths are relative
      relativeImports.add(specifier);
    }

    // Check declare module
    DECLARE_MODULE_PATTERN.lastIndex = 0;
    match = DECLARE_MODULE_PATTERN.exec(line);
    if (match) {
      const specifier = match[1];
      imports.push({
        type: 'declare-module',
        specifier,
        statement: line.trim(),
        line: lineNum,
      });
      // Don't add declare module to dependencies - they're declarations, not imports
    }
  }

  return {
    imports,
    externalPackages: Array.from(externalPackages),
    relativeImports: Array.from(relativeImports),
  };
}

/**
 * Categorize a specifier as external package or relative import.
 */
function categorizeSpecifier(specifier: string, externalPackages: Set<string>, relativeImports: Set<string>): void {
  if (isRelativeImport(specifier)) {
    relativeImports.add(specifier);
  } else {
    externalPackages.add(getPackageFromSpecifier(specifier));
  }
}

/**
 * Check if a specifier is a relative import.
 *
 * @param specifier - The import specifier
 * @returns true if the specifier is a relative path
 */
export function isRelativeImport(specifier: string): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    // Check for Windows-style paths
    /^[A-Za-z]:/.test(specifier)
  );
}

/**
 * Extract the package name from a specifier.
 *
 * Handles scoped packages (@org/package) and subpath imports.
 *
 * @param specifier - The import specifier
 * @returns The package name
 *
 * @example
 * ```typescript
 * getPackageFromSpecifier('react') // 'react'
 * getPackageFromSpecifier('react/jsx-runtime') // 'react'
 * getPackageFromSpecifier('@frontmcp/ui') // '@frontmcp/ui'
 * getPackageFromSpecifier('@frontmcp/ui/react') // '@frontmcp/ui'
 * ```
 */
export function getPackageFromSpecifier(specifier: string): string {
  // Handle scoped packages
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return specifier;
  }

  // Handle non-scoped packages
  const slashIndex = specifier.indexOf('/');
  if (slashIndex > 0) {
    return specifier.substring(0, slashIndex);
  }

  return specifier;
}

/**
 * Get the subpath from a specifier.
 *
 * @param specifier - The import specifier
 * @returns The subpath or undefined if none
 *
 * @example
 * ```typescript
 * getSubpathFromSpecifier('react') // undefined
 * getSubpathFromSpecifier('react/jsx-runtime') // 'jsx-runtime'
 * getSubpathFromSpecifier('@frontmcp/ui/react') // 'react'
 * ```
 */
export function getSubpathFromSpecifier(specifier: string): string | undefined {
  const packageName = getPackageFromSpecifier(specifier);
  if (specifier.length > packageName.length + 1) {
    return specifier.substring(packageName.length + 1);
  }
  return undefined;
}

/**
 * Parse an import statement to extract the specifier.
 *
 * @param statement - The import statement string
 * @returns The specifier or null if not a valid import
 *
 * @example
 * ```typescript
 * parseImportStatement('import { Card } from "@frontmcp/ui/react"')
 * // '@frontmcp/ui/react'
 * ```
 */
export function parseImportStatement(statement: string): string | null {
  // Try named/default import pattern
  const namedMatch = /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/.exec(statement);
  if (namedMatch) {
    return namedMatch[1];
  }

  // Try side-effect import pattern
  const sideEffectMatch = /import\s+['"]([^'"]+)['"]/.exec(statement);
  if (sideEffectMatch) {
    return sideEffectMatch[1];
  }

  return null;
}

/**
 * Combine multiple .d.ts contents into a single file.
 *
 * Deduplicates triple-slash references and organizes imports.
 *
 * @param contents - Map of URL to .d.ts content
 * @returns Combined .d.ts content
 */
export function combineDtsContents(contents: Map<string, string>): string {
  const seenReferences = new Set<string>();
  const references: string[] = [];
  const declarations: string[] = [];

  for (const [url, content] of contents.entries()) {
    const lines = content.split('\n');
    let inReferences = true;

    for (const line of lines) {
      const trimmed = line.trim();

      // Handle reference directives
      if (trimmed.startsWith('///')) {
        if (!seenReferences.has(trimmed)) {
          seenReferences.add(trimmed);
          references.push(trimmed);
        }
        continue;
      }

      // Empty line after references is still in references section
      if (inReferences && trimmed === '') {
        continue;
      }

      // Once we hit non-reference content, we're past references
      inReferences = false;

      // Add separator comment for each file
      if (declarations.length === 0 || declarations[declarations.length - 1] !== '') {
        if (trimmed !== '') {
          // Add file marker only for non-empty content
          if (!declarations.some((d) => d.includes(`// Source: ${url}`))) {
            declarations.push(`\n// Source: ${url}`);
          }
        }
      }

      declarations.push(line);
    }
  }

  // Combine references at the top, then declarations
  const parts: string[] = [];
  if (references.length > 0) {
    parts.push(references.join('\n'));
    parts.push('');
  }
  parts.push(declarations.join('\n').trim());

  return parts.join('\n');
}
