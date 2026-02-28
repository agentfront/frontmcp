/**
 * Import Parser
 *
 * Parses JavaScript/TypeScript source code to extract import statements.
 * Identifies external (npm) vs relative (local) imports.
 *
 * @packageDocumentation
 */

import type { ParsedImport, ParsedImportResult } from './types';

const IMPORT_PATTERNS = {
  named: /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
  default: /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
  namespace: /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
  sideEffect: /import\s*['"]([^'"]+)['"]/g,
  dynamic: /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  defaultAndNamed: /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
  defaultAndNamespace: /import\s+(\w+)\s*,\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
  reExport: /export\s*\{[^}]+\}\s*from\s*['"]([^'"]+)['"]/g,
  reExportAll: /export\s*\*\s*from\s*['"]([^'"]+)['"]/g,
};

function parseNamedImports(namedString: string): string[] {
  return namedString
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const asMatch = s.match(/^(\w+)\s+as\s+\w+$/);
      return asMatch ? asMatch[1] : s;
    });
}

function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}

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
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return specifier;
  }

  const firstSlash = specifier.indexOf('/');
  return firstSlash === -1 ? specifier : specifier.slice(0, firstSlash);
}

function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function getColumnNumber(source: string, index: number): number {
  let column = 0;
  for (let i = index - 1; i >= 0 && source[i] !== '\n'; i--) {
    column++;
  }
  return column;
}

/**
 * Parse all import statements from source code.
 */
export function parseImports(source: string): ParsedImportResult {
  const imports: ParsedImport[] = [];
  const seenStatements = new Set<string>();

  const addImport = (imp: ParsedImport) => {
    const key = `${imp.type}:${imp.specifier}:${imp.statement}`;
    if (!seenStatements.has(key)) {
      seenStatements.add(key);
      imports.push(imp);
    }
  };

  let match;

  // Combined default and named: import foo, { bar } from 'module'
  const defaultAndNamedRegex = new RegExp(IMPORT_PATTERNS.defaultAndNamed.source, 'g');
  while ((match = defaultAndNamedRegex.exec(source)) !== null) {
    const [statement, defaultName, namedString, specifier] = match;
    addImport({
      statement,
      specifier,
      type: 'default',
      defaultImport: defaultName,
      namedImports: parseNamedImports(namedString),
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Combined default and namespace
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

  // Named imports
  const namedRegex = new RegExp(IMPORT_PATTERNS.named.source, 'g');
  while ((match = namedRegex.exec(source)) !== null) {
    const [statement, namedString, specifier] = match;
    addImport({
      statement,
      specifier,
      type: 'named',
      namedImports: parseNamedImports(namedString),
      line: getLineNumber(source, match.index),
      column: getColumnNumber(source, match.index),
    });
  }

  // Default imports
  const defaultRegex = new RegExp(IMPORT_PATTERNS.default.source, 'g');
  while ((match = defaultRegex.exec(source)) !== null) {
    const [statement, defaultName, specifier] = match;
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

  // Namespace imports
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

  // Side-effect imports
  const sideEffectRegex = new RegExp(IMPORT_PATTERNS.sideEffect.source, 'g');
  while ((match = sideEffectRegex.exec(source)) !== null) {
    const [statement, specifier] = match;
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

  // Dynamic imports
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

  // Re-exports
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

  // Re-export all
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

  const externalImports = imports.filter((imp) => isExternalImport(imp.specifier));
  const relativeImports = imports.filter((imp) => isRelativeImport(imp.specifier));
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
 */
export function extractExternalPackages(source: string): string[] {
  return parseImports(source).externalPackages;
}
