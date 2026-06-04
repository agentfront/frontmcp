/**
 * Pluggable shell descriptor tests for the INLINE-MODULE render path.
 *
 * The inline-module path (transpiled, NON-bundled `code`) is the one whose
 * mount tail + injected window global are made pluggable so the SAME
 * `renderComponent` pipeline can serve a different shell (a custom non-widget
 * page) without forking the import-map / single-React handling.
 *
 * These tests drive `renderComponent` with a mocked `resolveUISource` that
 * returns un-bundled inline `code` (the shape a custom-shell caller routes
 * through), then assert:
 *  1. DEFAULT (no descriptor) → the historical widget mount tail
 *     (`McpBridgeProvider` from `@frontmcp/ui/react`) + the `window.__mcp*`
 *     data injection, byte-for-byte unchanged.
 *  2. CUSTOM descriptor → a custom mount tail (its own specifier + mounter) and
 *     a custom injected global, with the custom mount specifier present in the
 *     import map and carrying the single-React `?external=react,react-dom`.
 */

import { renderComponent } from '../renderer';
import type { ResolvedComponent } from '../types';

// Mock only `resolveUISource` so we can return un-bundled inline `code`
// (the custom-shell shape). `generateMountScript` keeps its real implementation.
const mockResolveUISource = jest.fn<ResolvedComponent, unknown[]>();
jest.mock('../loader', () => ({
  ...jest.requireActual('../loader'),
  resolveUISource: (...args: unknown[]) => mockResolveUISource(...args),
}));

const INLINE_CODE = `import React from "react";
const Widget = () => React.createElement("div", null, "hi");
export default Widget;`;

function inlineResolved(): ResolvedComponent {
  return {
    mode: 'module',
    code: INLINE_CODE,
    imports: ['react', 'react-dom'],
    exportName: 'Widget',
    meta: { mcpAware: true, renderer: 'react' },
    peerDependencies: ['react', 'react-dom'],
    // bundled intentionally undefined → inline-module path
  };
}

function extractModuleScript(html: string): string {
  const m = html.match(/<script type="module">\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('no module script found');
  return m[1];
}

function extractImportMap(html: string): Record<string, string> {
  const m = html.match(/<script type="importmap">\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('no import map found');
  return JSON.parse(m[1]).imports as Record<string, string>;
}

beforeEach(() => {
  mockResolveUISource.mockReset();
  mockResolveUISource.mockReturnValue(inlineResolved());
});

describe('inline-module DEFAULT shell (widget) — unchanged', () => {
  it('emits the McpBridgeProvider mount tail from @frontmcp/ui/react', () => {
    const result = renderComponent({ source: { file: '/app/widget.tsx' } }, { toolName: 'test', output: {} });
    const moduleScript = extractModuleScript(result.html);

    // Byte-for-byte historical widget mount tail.
    const expectedTail = `
// --- Mount ---
import { createRoot as __createRoot } from 'react-dom/client';
import { McpBridgeProvider as __McpBridgeProvider } from '@frontmcp/ui/react';
const __root = document.getElementById('root');
if (__root) {
  __createRoot(__root).render(
    React.createElement(__McpBridgeProvider, null,
      React.createElement(Widget)
    )
  );
}`;
    expect(moduleScript).toBe(`${INLINE_CODE}\n${expectedTail}`);
  });

  it('injects the default window.__mcp* widget globals', () => {
    const result = renderComponent({ source: { file: '/app/widget.tsx' } }, { toolName: 'my_tool', output: { a: 1 } });
    expect(result.html).toContain('window.__mcpToolName = "my_tool";');
    expect(result.html).toContain('window.__mcpToolOutput = {"a":1};');
    // No custom global is injected when no dataInjection descriptor is supplied.
    expect(result.html).not.toContain('window["__MY_PAGE_STATE__"]');
  });

  it('maps @frontmcp/ui/react in the import map with ?external=react,react-dom', () => {
    const result = renderComponent({ source: { file: '/app/widget.tsx' } }, { toolName: 'test', output: {} });
    const imports = extractImportMap(result.html);
    expect(imports['@frontmcp/ui/react']).toBeDefined();
    expect(imports['@frontmcp/ui/react']).toContain('external=react,react-dom');
  });
});

describe('inline-module CUSTOM shell (generic mechanism a non-widget caller uses)', () => {
  const customShellConfig = {
    toolName: 'custom_page',
    output: {},
    // includeBridge:false mirrors how a non-widget caller uses the pipeline —
    // the widget bridge IIFE legitimately references `window.__mcpToolName`, so
    // dropping it keeps the negative assertions clean.
    includeBridge: false,
    mount: {
      moduleSpecifier: '@example/page-runtime',
      generate: (exportName: string) =>
        `\nimport { mountPage as __mountPage } from '@example/page-runtime';\n__mountPage(${exportName});`,
    },
    dataInjection: {
      globalKey: '__EXAMPLE_PAGE__',
      value: { page: 'home', token: 'tok' },
    },
  };

  it('emits the CUSTOM mount tail (custom specifier + mounter), not the widget one', () => {
    const result = renderComponent({ source: { file: '/app/page.tsx' } }, customShellConfig);
    const moduleScript = extractModuleScript(result.html);

    expect(moduleScript).toContain("import { mountPage as __mountPage } from '@example/page-runtime';");
    expect(moduleScript).toContain('__mountPage(Widget);');
    // The widget mount must NOT appear.
    expect(moduleScript).not.toContain('McpBridgeProvider');
    expect(moduleScript).not.toContain('@frontmcp/ui/react');
  });

  it('injects the CUSTOM window global, not the widget __mcp* data', () => {
    const result = renderComponent({ source: { file: '/app/page.tsx' } }, customShellConfig);
    expect(result.html).toContain('window["__EXAMPLE_PAGE__"] = {"page":"home","token":"tok"};');
    // No `window.__mcp* = ` assignment (the data-injection script) is emitted.
    expect(result.html).not.toContain('window.__mcpToolName = ');
    expect(result.html).not.toContain('window.__mcpToolOutput = ');
  });

  it('adds the CUSTOM mount specifier to the import map with single-React ?external treatment', () => {
    const result = renderComponent({ source: { file: '/app/page.tsx' } }, customShellConfig);
    const imports = extractImportMap(result.html);
    expect(imports['@example/page-runtime']).toBeDefined();
    expect(imports['@example/page-runtime']).toContain('external=react,react-dom');
    // The default widget mounter is NOT pulled in when a custom mount is supplied.
    expect(imports['@frontmcp/ui/react']).toBeUndefined();
  });

  it('emits the pluggable mount node id + inner html (not the default #root)', () => {
    const result = renderComponent(
      { source: { file: '/app/page.tsx' } },
      {
        ...customShellConfig,
        mount: {
          ...customShellConfig.mount,
          mountNodeId: 'my-page-root',
          mountNodeInnerHtml: '<noscript>js req</noscript>',
        },
      },
    );
    expect(result.html).toContain('<div id="my-page-root"><noscript>js req</noscript></div>');
    // The default widget #root node is NOT emitted when a custom id is given.
    expect(result.html).not.toContain('<div id="root">');
  });

  it('does NOT map react-dom/server or react-dom/static for a custom (non-widget) mount', () => {
    const result = renderComponent({ source: { file: '/app/page.tsx' } }, customShellConfig);
    const imports = extractImportMap(result.html);
    // The SSR-ish subpaths back the widget bridge only; a custom mount maps just
    // what the source imports (+ react-dom/client) — so an auth page never
    // advertises react-dom/server.
    expect(imports['react-dom/server']).toBeUndefined();
    expect(imports['react-dom/static']).toBeUndefined();
  });

  it('supports a wrapperImportName-only custom mount (no generate override) and honors mountNodeId', () => {
    const result = renderComponent(
      { source: { file: '/app/page.tsx' } },
      {
        toolName: 'custom_page',
        output: {},
        mount: {
          moduleSpecifier: '@example/page-runtime',
          wrapperImportName: 'PageProvider',
          mountNodeId: 'page-root',
        },
      },
    );
    const moduleScript = extractModuleScript(result.html);
    expect(moduleScript).toContain("import { PageProvider as __PageProvider } from '@example/page-runtime';");
    expect(moduleScript).toContain('React.createElement(__PageProvider, null,');
    expect(moduleScript).toContain('React.createElement(Widget)');
    // The wrapper tail mounts into the configured node, not the hardcoded #root.
    expect(moduleScript).toContain("document.getElementById('page-root')");
    expect(moduleScript).not.toContain("document.getElementById('root')");
  });

  it('default widget wrapper tail still mounts into #root (mountNodeId unset)', () => {
    const result = renderComponent({ source: { file: '/app/widget.tsx' } }, { toolName: 'w', output: {} });
    const moduleScript = extractModuleScript(result.html);
    expect(moduleScript).toContain("document.getElementById('root')");
  });

  it('emits a fully custom data-injection script verbatim when `script` is provided', () => {
    const result = renderComponent(
      { source: { file: '/app/page.tsx' } },
      {
        toolName: 'custom_page',
        output: {},
        includeBridge: false,
        dataInjection: { script: '<script>window.CUSTOM = 1;</script>' },
      },
    );
    expect(result.html).toContain('<script>window.CUSTOM = 1;</script>');
    expect(result.html).not.toContain('window.__mcpToolName = ');
  });
});
