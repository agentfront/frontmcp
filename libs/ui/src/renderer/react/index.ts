import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import type { ContentRenderer, RenderOptions } from '../types';
import { runtimeImport } from '../common/lazy-import';
import { transpileJsx } from '../../runtime/babel-runtime';

// ============================================
// Detection
// ============================================

/**
 * Detect whether content looks like a React/JSX component source.
 */
export function isReactJsx(content: string): boolean {
  return /(?:function|const|class)\s+\w+/.test(content) && /(?:return|=>)\s*[\s(]*</.test(content);
}

// ============================================
// Import / Export Parsing
// ============================================

export interface ParsedImport {
  /** Full matched line */
  line: string;
  /** Local binding name (default import) or namespace name */
  localName: string;
  /** Module specifier */
  specifier: string;
  /** Whether it's a named import like { X } */
  named: boolean;
}

/**
 * Extract import statements from source code.
 *
 * Supports:
 * - `import React from 'https://esm.sh/react@19'`
 * - `import { useState } from 'https://esm.sh/react@19'`
 */
export function parseImports(source: string): ParsedImport[] {
  const results: ParsedImport[] = [];

  // Default imports: import X from '...'
  const defaultRe = /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = defaultRe.exec(source)) !== null) {
    results.push({ line: m[0], localName: m[1], specifier: m[2], named: false });
  }

  // Named imports: import { X } from '...'  or  import { X, Y } from '...'
  const namedRe = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
  while ((m = namedRe.exec(source)) !== null) {
    const names = m[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    for (const name of names) {
      results.push({ line: m[0], localName: name, specifier: m[2], named: true });
    }
  }

  return results;
}

/**
 * Strip import statements from source code.
 */
export function stripImports(source: string): string {
  return source
    .replace(/^import\s+\w+\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
}

/**
 * Rewrite `export default X` to `var __default__ = X`.
 * Handles:
 * - `export default MyComp`
 * - `export default function Foo() {`
 * - `export default class Foo {`
 * - `export default () => {`
 */
export function rewriteExportDefault(source: string): string {
  // `export default function/class ...` → `var __default__ = function/class ...`
  let result = source.replace(/^export\s+default\s+(function|class)\b/gm, 'var __default__ = $1');

  // `export default () =>` or `export default (props) =>`
  result = result.replace(/^export\s+default\s+(\([^)]*\)\s*=>)/gm, 'var __default__ = $1');

  // `export default Identifier;` or `export default Identifier`
  result = result.replace(/^export\s+default\s+(\w+)\s*;?\s*$/gm, 'var __default__ = $1;');

  return result;
}

// ============================================
// Module Resolution
// ============================================

/**
 * Check if a module specifier refers to React.
 * Matches: 'react', 'https://esm.sh/react', 'https://esm.sh/react@19', etc.
 */
function isReactSpecifier(specifier: string): boolean {
  return specifier === 'react' || /^https?:\/\/esm\.sh\/react(?:@[\d.]+)?$/.test(specifier);
}

/**
 * Resolve all imports to actual module values.
 * React is resolved from the host app's React instance to avoid dual-React issues.
 */
async function resolveModules(imports: ParsedImport[]): Promise<Record<string, unknown>> {
  const modules: Record<string, unknown> = {};

  // Group imports by specifier to avoid duplicate loads
  const specifierMap = new Map<string, ParsedImport[]>();
  for (const imp of imports) {
    const existing = specifierMap.get(imp.specifier) ?? [];
    existing.push(imp);
    specifierMap.set(imp.specifier, existing);
  }

  for (const [specifier, specImports] of specifierMap) {
    let mod: Record<string, unknown>;

    if (isReactSpecifier(specifier)) {
      // Use host app's React to avoid dual-React issues
      mod = React as unknown as Record<string, unknown>;
    } else {
      mod = await runtimeImport(specifier);
    }

    for (const imp of specImports) {
      if (imp.named) {
        modules[imp.localName] = (mod[imp.localName] ??
          (mod['default'] as Record<string, unknown>)?.[imp.localName]) as unknown;
      } else {
        modules[imp.localName] = mod['default'] ?? mod;
      }
    }
  }

  return modules;
}

// ============================================
// Component
// ============================================

interface ReactJsxViewProps {
  source: string;
  className?: string;
}

function ReactJsxView({ source, className }: ReactJsxViewProps): React.ReactElement {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function transpileAndRender(): Promise<void> {
      try {
        // 1. Parse imports
        const imports = parseImports(source);

        // 2. Resolve modules
        const modules = await resolveModules(imports);

        // 3. Strip imports and rewrite exports
        let code = stripImports(source);
        code = rewriteExportDefault(code);

        // 4. Transpile JSX
        code = await transpileJsx(code, 'component.jsx');

        // 5. Append default return
        code += '\nreturn __default__;';

        // 6. Build and execute function
        const argNames = Object.keys(modules);
        const argValues = argNames.map((n) => modules[n]);

        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const factory = new Function(...argNames, code) as (...args: unknown[]) => React.ComponentType;
        const Comp = factory(...argValues);

        if (!cancelled) {
          setComponent(() => Comp);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setComponent(null);
          setLoading(false);
        }
      }
    }

    setLoading(true);
    setError(null);
    setComponent(null);
    transpileAndRender();

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (loading) {
    return React.createElement(Box, { className, sx: { p: 2, color: 'text.secondary' } }, 'Transpiling JSX...');
  }

  if (error) {
    return React.createElement(
      Box,
      { className },
      React.createElement(Alert, { severity: 'error', sx: { mb: 1 } }, `JSX render error: ${error}`),
      React.createElement(
        'pre',
        { style: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: '0.85em' } },
        source,
      ),
    );
  }

  if (!Component) {
    return React.createElement(
      Box,
      { className },
      React.createElement(Alert, { severity: 'warning' }, 'No component exported. Use `export default MyComponent`.'),
    );
  }

  return React.createElement(Box, { className }, React.createElement(Component, {}));
}

// ============================================
// Renderer
// ============================================

export class ReactJsxRenderer implements ContentRenderer {
  readonly type = 'jsx';
  readonly priority = 10;

  canHandle(content: string): boolean {
    return isReactJsx(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(ReactJsxView, {
      source: content,
      className: options?.className ?? 'fmcp-jsx-content',
    });
  }
}

export const reactJsxRenderer = new ReactJsxRenderer();
