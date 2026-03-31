/**
 * React TSX/JSX Transpiler
 *
 * Uses esbuild to transpile React source files (TSX/JSX) into browser-ready
 * ES module code with React.createElement calls. No React dependency needed
 * at transpilation time — only syntax transformation.
 *
 * @packageDocumentation
 */

import type { TransformOptions, BuildOptions } from 'esbuild';

/**
 * Transpile React TSX/JSX source code into browser-ready ES module code.
 *
 * Converts JSX syntax to React.createElement calls and strips TypeScript types.
 * The output is suitable for embedding as an inline `<script type="module">`.
 *
 * @param source - Raw TSX/JSX source code
 * @param filename - Optional filename hint for loader detection (e.g. 'component.tsx')
 * @returns Transpiled JavaScript source code (ESM format)
 */
export function transpileReactSource(source: string, filename?: string): string {
  // Lazy-require esbuild to avoid import errors in browser builds

  const esbuild = require('esbuild') as typeof import('esbuild');

  const loader: TransformOptions['loader'] = filename?.endsWith('.tsx') ? 'tsx' : 'jsx';

  const result = esbuild.transformSync(source, {
    loader,
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    format: 'esm',
    target: 'es2020',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  return result.code;
}

/**
 * Bundle a FileSource .tsx/.jsx file with esbuild's buildSync.
 *
 * Resolves workspace dependencies (e.g. @frontmcp/ui) from local node_modules,
 * inlines all non-React deps, and appends mount code so the output is a
 * self-contained ES module that only depends on react/react-dom externally.
 *
 * @param source - Raw TSX/JSX source code
 * @param filename - Filename hint for loader detection (e.g. 'widget.tsx')
 * @param resolveDir - Directory for resolving bare imports (typically dirname of the source file)
 * @param componentName - Name of the component to mount (extracted from source)
 * @returns Bundled JavaScript source code
 */
export function bundleFileSource(
  source: string,
  filename: string,
  resolveDir: string,
  componentName: string,
): { code: string } {
  const esbuild = require('esbuild') as typeof import('esbuild');

  const mountCode = `
// --- Auto-generated mount ---
import { createElement as __h } from 'react';
import { createRoot } from 'react-dom/client';
import { McpBridgeProvider } from '@frontmcp/ui/react';
var __root = document.getElementById('root');
if (__root) {
  var __reactRoot = createRoot(__root);
  function __hasData(v) { return v != null && typeof v === 'object' && Object.keys(v).length > 0; }
  function __render(output) {
    __reactRoot.render(
      __h(McpBridgeProvider, null,
        __h(${componentName}, { output: output || null, input: window.__mcpToolInput, loading: !__hasData(output) })
      )
    );
  }
  // Render immediately (component shows loading state until data arrives)
  __render(null);
  // 1. Try OpenAI SDK (toolOutput set synchronously or after load)
  if (typeof window !== 'undefined') {
    if (!window.openai) window.openai = {};
    var __cur = window.openai.toolOutput;
    if (__hasData(__cur)) { __render(__cur); }
    Object.defineProperty(window.openai, 'toolOutput', {
      get: function() { return __cur; },
      set: function(v) { __cur = v; __render(v); },
      configurable: true, enumerable: true
    });
  }
  // 2. Try injected data globals
  if (__hasData(window.__mcpToolOutput)) { __render(window.__mcpToolOutput); }
  // 3. Listen for bridge tool-result (ext-apps / MCP Inspector)
  var __bridge = window.FrontMcpBridge;
  if (__bridge && typeof __bridge.onToolResult === 'function') {
    __bridge.onToolResult(function(data) { __render(data); });
  }
  // 4. Listen for tool:result CustomEvent
  window.addEventListener('tool:result', function(e) {
    var d = e.detail;
    if (d) __render(d.structuredContent || d.content || d);
  });
}`;

  const loader: BuildOptions['loader'] = {
    '.tsx': 'tsx',
    '.jsx': 'jsx',
  };
  const stdinLoader = filename.endsWith('.tsx') ? 'tsx' : 'jsx';

  // Resolve @frontmcp/ui subpaths from local ESM dist when available.
  // This ensures the widget uses the local build instead of the published esm.sh version.
  // Uses runtime resolution from node_modules to avoid build-time circular deps.
  const alias: Record<string, string> = {};
  try {
    const nodePath = require('path') as typeof import('path');
    const nodeFs = require('fs') as typeof import('fs');
    // Look for @frontmcp/ui in node_modules (symlinked in monorepo)
    const candidates = [
      nodePath.join(process.cwd(), 'node_modules', '@frontmcp', 'ui', 'dist', 'esm'),
      nodePath.join(resolveDir, 'node_modules', '@frontmcp', 'ui', 'dist', 'esm'),
    ];
    for (const uiEsmBase of candidates) {
      if (!nodeFs.existsSync(uiEsmBase)) continue;
      const subpaths = ['components', 'react', 'theme', 'bridge', 'runtime'];
      for (const sub of subpaths) {
        const mjs = nodePath.join(uiEsmBase, sub, 'index.mjs');
        if (nodeFs.existsSync(mjs)) alias[`@frontmcp/ui/${sub}`] = mjs;
      }
      if (Object.keys(alias).length > 0) break;
    }
  } catch {
    // fs/path not available or @frontmcp/ui not found — aliases stay empty.
  }

  try {
    const result = esbuild.buildSync({
      stdin: {
        contents: source + '\n' + mountCode,
        loader: stdinLoader,
        resolveDir,
        sourcefile: filename,
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2020',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      alias,
      define: { 'process.env.NODE_ENV': '"production"' },
      platform: 'browser',
      treeShaking: true,
      logLevel: 'warning',
      loader,
    });

    return { code: result.outputFiles[0].text };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to bundle FileSource "${filename}": ${message}. ` +
        `Ensure workspace packages are built (e.g. nx build ui).`,
    );
  }
}

/**
 * Extract the default export name from transpiled source code.
 *
 * Supports patterns:
 * - `export default function ComponentName`
 * - `export default class ComponentName`
 * - `export default ComponentName;`
 *
 * @param code - Transpiled JavaScript source code
 * @returns The export name, or null if not found
 */
export function extractDefaultExportName(code: string): string | null {
  // export default function NAME / class NAME
  let match = code.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
  if (match) return match[1];

  // export default NAME;
  match = code.match(/export\s+default\s+(\w+)\s*;/);
  if (match) return match[1];

  return null;
}
