/**
 * Component Loader
 *
 * Resolves any UISource to a loadable component and generates
 * mount scripts for the browser.
 *
 * @packageDocumentation
 */

import type { ImportResolver, ResolvedImport } from '../resolver/types';
import { createEsmShResolver } from '../resolver/esm-sh.resolver';
import { getPackageName, parseImports } from '../resolver/import-parser';
import type {
  UISource,
  NpmSource,
  FileSource,
  ImportSource,
  FunctionSource,
  ResolvedComponent,
  ComponentMeta,
} from './types';
import { isNpmSource, isFileSource, isImportSource, isFunctionSource, FRONTMCP_META_KEY } from './types';
import { safeJsonForScript } from '../utils';
import { bundleFileSource, extractDefaultExportName } from './transpiler';

const DEFAULT_META: ComponentMeta = {
  mcpAware: false,
  renderer: 'auto',
};

/**
 * Resolve a UISource to a loadable component.
 *
 * - npm: uses ImportResolver to get CDN URL
 * - file: reads file or resolves to served URL (inline mode defaults to true for small files)
 * - import: passes URL through directly
 * - function: executes with input/output, returns HTML string
 */
export function resolveUISource(
  source: UISource,
  options?: {
    resolver?: ImportResolver;
    input?: unknown;
    output?: unknown;
  },
): ResolvedComponent {
  const resolver = options?.resolver ?? createEsmShResolver();

  if (isNpmSource(source)) {
    return resolveNpmSource(source, resolver);
  }

  if (isImportSource(source)) {
    return resolveImportSource(source);
  }

  if (isFileSource(source)) {
    return resolveFileSource(source);
  }

  if (isFunctionSource(source)) {
    return resolveFunctionSource(source, options?.input, options?.output);
  }

  throw new Error('Unknown UISource type');
}

function resolveNpmSource(source: NpmSource, resolver: ImportResolver): ResolvedComponent {
  const specifier = source.version ? `${source.npm}@${source.version}` : source.npm;
  const pkgName = getPackageName(source.npm);

  const resolved: ResolvedImport | null = resolver.resolve(specifier);

  const url = resolved?.value ?? `https://esm.sh/${specifier}`;

  // Determine peer dependencies from package name
  const peerDeps: string[] = [];
  if (pkgName !== 'react' && pkgName !== 'react-dom') {
    // Most npm UI components need React
    peerDeps.push('react', 'react-dom');
  }

  return {
    mode: 'module',
    url,
    exportName: source.exportName ?? 'default',
    meta: { ...DEFAULT_META, renderer: 'react' },
    peerDependencies: peerDeps,
  };
}

function resolveImportSource(source: ImportSource): ResolvedComponent {
  return {
    mode: 'module',
    url: source.import,
    exportName: source.exportName ?? 'default',
    meta: { ...DEFAULT_META },
    peerDependencies: [],
  };
}

function resolveFileSource(source: FileSource): ResolvedComponent {
  const path = require('path') as typeof import('path');
  const ext = path.extname(source.file).toLowerCase();

  // React source files (.tsx/.jsx) — bundle with esbuild, embed as inline module
  if (ext === '.tsx' || ext === '.jsx') {
    const fs = require('fs') as typeof import('fs');
    const filePath = path.isAbsolute(source.file) ? source.file : path.resolve(process.cwd(), source.file);
    const rawSource = fs.readFileSync(filePath, 'utf-8');

    // Extract name from RAW source (before bundling changes export structure)
    const componentName = source.exportName || extractDefaultExportName(rawSource) || 'Component';

    // Bundle: workspace deps resolved locally, react external
    const bundled = bundleFileSource(rawSource, source.file, path.dirname(filePath), componentName);

    // Parse bundled output for remaining external imports (react/react-dom subpaths)
    const parsed = parseImports(bundled.code);

    return {
      mode: 'module',
      code: bundled.code,
      imports: [...new Set(parsed.externalImports.map((i) => i.specifier))],
      exportName: componentName,
      meta: { mcpAware: true, renderer: 'react' },
      peerDependencies: source.peerDependencies || ['react', 'react-dom'],
      bundled: true,
    };
  }

  // Non-React file sources — existing behavior
  if (source.inline) {
    return {
      mode: 'inline',
      html: `<!-- File source: ${source.file} (inline mode - content to be resolved at build time) -->`,
      exportName: 'default',
      meta: { ...DEFAULT_META, renderer: 'html' },
      peerDependencies: [],
    };
  }

  return {
    mode: 'module',
    url: source.file,
    exportName: 'default',
    meta: { ...DEFAULT_META },
    peerDependencies: [],
  };
}

function resolveFunctionSource(source: FunctionSource, input: unknown, output: unknown): ResolvedComponent {
  const html = source(input, output);
  return {
    mode: 'inline',
    html,
    exportName: 'default',
    meta: { mcpAware: false, renderer: 'html' },
    peerDependencies: [],
  };
}

/**
 * Generate a mount script for module-based components.
 *
 * For non-MCP-aware components: passes output as props.
 * For MCP-aware components: component reads bridge globals internally.
 */
export function generateMountScript(resolved: ResolvedComponent, propsMapping?: Record<string, string>): string {
  if (resolved.mode !== 'module' || !resolved.url) {
    return '';
  }

  const componentImport =
    resolved.exportName === 'default'
      ? `import Component from '${resolved.url}';`
      : `import { ${resolved.exportName} as Component } from '${resolved.url}';`;

  if (resolved.meta.mcpAware) {
    // MCP-aware: component reads bridge internally
    return `${componentImport}
import React from 'react';
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root'))
  .render(React.createElement(Component));`;
  }

  // Non-MCP-aware: pass props directly
  const propsCode = propsMapping ? generateMappedPropsCode(propsMapping) : 'window.__mcpToolOutput';

  return `${componentImport}
import React from 'react';
import { createRoot } from 'react-dom/client';
const output = window.__mcpToolOutput;
const props = ${propsCode};
createRoot(document.getElementById('root'))
  .render(React.createElement(Component, props));`;
}

/**
 * Generate JavaScript code that extracts mapped props from the output object.
 */
function generateMappedPropsCode(mapping: Record<string, string>): string {
  const entries = Object.entries(mapping)
    .map(([prop, path]) => {
      const accessPath = path
        .split('.')
        .map((part) => `[${safeJsonForScript(part)}]`)
        .join('');
      return `${safeJsonForScript(prop)}: output${accessPath}`;
    })
    .join(', ');

  return `({ ${entries} })`;
}

/**
 * Well-known export for metadata auto-detection.
 */
export { FRONTMCP_META_KEY };
