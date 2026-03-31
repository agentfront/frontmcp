/**
 * Renderer Tests
 *
 * Tests for renderComponent() with FileSource, verifying:
 * - Bundled path: import map has only react/react-dom, no ?external, no separate mount code
 * - Non-bundled (URL) path: existing behavior preserved
 */

import { renderComponent } from '../renderer';
import type { FileSource } from '../types';

// Bundled output simulates what esbuild.buildSync produces:
// all workspace deps inlined, only react/react-dom remain as imports.
const BUNDLED_OUTPUT = `import React from "react";
import { createRoot } from "react-dom/client";
var useToolOutput = () => window.__mcpToolOutput;
var McpBridgeProvider = ({ children }) => children;
var Widget = () => {
  const data = useToolOutput();
  return React.createElement("div", null, JSON.stringify(data));
};
var __root = document.getElementById("root");
if (__root) {
  createRoot(__root).render(
    React.createElement(McpBridgeProvider, null,
      React.createElement(Widget)
    )
  );
}
`;

// Mock fs.readFileSync and esbuild.buildSync to avoid real file I/O
jest.mock('fs', () => ({
  readFileSync: jest.fn(
    () => `
import React from 'react';
import { useToolOutput } from '@frontmcp/ui/react';
export default function Widget() {
  const data = useToolOutput();
  return <div>{JSON.stringify(data)}</div>;
}
`,
  ),
}));

jest.mock('path', () => ({
  extname: jest.fn((f: string) => {
    const m = f.match(/\.[^.]+$/);
    return m ? m[0] : '';
  }),
  isAbsolute: jest.fn(() => true),
  resolve: jest.fn((...args: string[]) => args[args.length - 1]),
  dirname: jest.fn((f: string) => f.replace(/\/[^/]+$/, '')),
}));

jest.mock('esbuild', () => ({
  buildSync: jest.fn(() => ({
    outputFiles: [{ text: BUNDLED_OUTPUT }],
  })),
  transformSync: jest.fn(() => ({
    code: BUNDLED_OUTPUT,
    warnings: [],
  })),
}));

describe('renderComponent with bundled FileSource', () => {
  const fileSource: FileSource = { file: '/app/components/widget.tsx' };

  it('should contain import map with only react/react-dom specifiers', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    const importMapMatch = result.html.match(/<script type="importmap">\n([\s\S]*?)\n<\/script>/);
    expect(importMapMatch).toBeTruthy();

    const importMap = JSON.parse(importMapMatch![1]);
    const specifiers = Object.keys(importMap.imports);

    // Bundled output only imports react and react-dom/client
    expect(specifiers).toContain('react');
    expect(specifiers).toContain('react-dom/client');

    // Should NOT contain workspace packages (they're bundled in)
    expect(specifiers).not.toContain('@frontmcp/ui/react');
    expect(specifiers).not.toContain('@frontmcp/ui/components');
  });

  it('should NOT apply ?external to any import map URLs', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    const importMapMatch = result.html.match(/<script type="importmap">\n([\s\S]*?)\n<\/script>/);
    const importMap = JSON.parse(importMapMatch![1]);

    for (const [, url] of Object.entries(importMap.imports)) {
      expect(url).not.toContain('?external');
    }
  });

  it('should contain root div element', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });
    expect(result.html).toContain('<div id="root"></div>');
  });

  it('should embed bundled code in a single module script', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    expect(result.html).toContain('<script type="module">');
    // The bundled code contains the mount code already
    expect(result.html).toContain('createRoot');
  });

  it('should NOT contain a separate mount script (mount is in the bundle)', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    // Count module scripts — should be exactly one
    const moduleScripts = result.html.match(/<script type="module">/g);
    expect(moduleScripts).toHaveLength(1);
  });

  it('should NOT contain McpBridgeProvider import from esm.sh in the import map', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    const importMapMatch = result.html.match(/<script type="importmap">\n([\s\S]*?)\n<\/script>/);
    const importMap = JSON.parse(importMapMatch![1]);

    // McpBridgeProvider should be bundled, not in the import map
    expect(importMap.imports['@frontmcp/ui/react']).toBeUndefined();
  });

  it('should use the correct component export name from raw source', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    // The mock esbuild.buildSync receives source with mount code referencing Widget
    const esbuild = require('esbuild');
    const buildCall = esbuild.buildSync.mock.calls[0][0];
    expect(buildCall.stdin.contents).toContain('Widget');
  });

  it('should produce valid hash and size', () => {
    const result = renderComponent({ source: fileSource }, { toolName: 'test', output: {} });

    expect(result.hash).toBeTruthy();
    expect(result.size).toBeGreaterThan(0);
  });
});

describe('renderComponent with URL-based source', () => {
  it('should generate import map for npm source peer dependencies', () => {
    const result = renderComponent(
      { source: { npm: '@acme/widget', exportName: 'Widget' } },
      { toolName: 'test', output: {} },
    );

    expect(result.html).toContain('<script type="importmap">');
    expect(result.html).toContain('react');
    expect(result.html).toContain('<div id="root"></div>');
  });

  it('should generate mount script for npm source', () => {
    const result = renderComponent(
      { source: { npm: '@acme/widget', exportName: 'Widget' } },
      { toolName: 'test', output: {} },
    );

    expect(result.html).toContain('<script type="module">');
    expect(result.html).toContain('createRoot');
  });
});
