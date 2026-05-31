/**
 * Template Renderer Tests
 *
 * Tests for renderToolTemplate().
 */

import { renderToolTemplate } from '../template-renderer';

// Mock fs and esbuild for FileSource tests.
jest.mock('fs', () => ({
  readFileSync: jest.fn(
    () => `
import React from 'react';
export default function Widget() {
  return <div>Hello</div>;
}
`,
  ),
  existsSync: jest.fn(() => true),
}));

// Short-circuit the #443 preflight: the path mock below replaces `path.join`,
// which `isFrontmcpUiResolvable` calls — easier to mock the helper directly.
jest.mock('../../component/ui-availability', () => ({
  isFrontmcpUiResolvable: jest.fn(() => true),
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
    outputFiles: [
      {
        text: `import React from "react";
import { createRoot } from "react-dom/client";
var Widget = () => React.createElement("div", null, "Hello");
var __root = document.getElementById("root");
if (__root) {
  createRoot(__root).render(React.createElement(Widget));
}
`,
      },
    ],
  })),
  transformSync: jest.fn(() => ({
    code: `import React from "react";
export default function Widget() {
  return React.createElement("div", null, "Hello");
}
`,
    warnings: [],
  })),
}));

describe('renderToolTemplate', () => {
  describe('FileSource template', () => {
    it('should detect uiType as "react" for .tsx file', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: { data: 'test' },
        template: { file: '/app/widget.tsx' },
      });

      expect(result.uiType).toBe('react');
    });

    it('should produce HTML with import map', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
      });

      expect(result.html).toContain('<script type="importmap">');
    });

    it('should produce HTML with module script', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
      });

      expect(result.html).toContain('<script type="module">');
    });

    it('should produce HTML with root div', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
      });

      expect(result.html).toContain('<div id="root"></div>');
    });

    it('should set meta key to ui/html by default', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
      });

      expect(result.meta).toHaveProperty('ui/html');
      expect(result.meta).toHaveProperty('ui/type', 'react');
    });

    it('plumbs resourceMode: "inline" down to esbuild, dropping React from externals (#454)', () => {
      const esbuild = require('esbuild');
      const buildSyncSpy = esbuild.buildSync as jest.Mock;
      buildSyncSpy.mockClear();

      renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
        resourceMode: 'inline',
      });

      // When resourceMode is 'inline', the bundler inlines React so the widget
      // is self-contained — no esm.sh import map, renders in Claude (#454).
      const opts = buildSyncSpy.mock.calls.at(-1)?.[0];
      expect(opts.external).toEqual([]);
    });

    it('keeps React external by default (resourceMode unset)', () => {
      const esbuild = require('esbuild');
      const buildSyncSpy = esbuild.buildSync as jest.Mock;
      buildSyncSpy.mockClear();

      renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
      });

      const opts = buildSyncSpy.mock.calls.at(-1)?.[0];
      expect(opts.external).toEqual(['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
    });

    it("auto-selects resourceMode:'inline' (and drops React from externals) when platformType is 'claude' and resourceMode is unset (#456)", () => {
      const esbuild = require('esbuild');
      const buildSyncSpy = esbuild.buildSync as jest.Mock;
      buildSyncSpy.mockClear();

      renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
        platformType: 'claude',
      });

      const opts = buildSyncSpy.mock.calls.at(-1)?.[0];
      expect(opts.external).toEqual([]);
    });

    it("respects an explicit resourceMode:'cdn' on Claude (user opt-out of auto-inline) (#456)", () => {
      const esbuild = require('esbuild');
      const buildSyncSpy = esbuild.buildSync as jest.Mock;
      buildSyncSpy.mockClear();

      renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
        platformType: 'claude',
        resourceMode: 'cdn',
      });

      const opts = buildSyncSpy.mock.calls.at(-1)?.[0];
      expect(opts.external).toEqual(['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
    });

    it("uses resourceMode:'cdn' by default for non-Claude platforms (#456)", () => {
      const esbuild = require('esbuild');
      const buildSyncSpy = esbuild.buildSync as jest.Mock;
      buildSyncSpy.mockClear();

      renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: { file: '/app/widget.tsx' },
        platformType: 'openai',
      });

      const opts = buildSyncSpy.mock.calls.at(-1)?.[0];
      expect(opts.external).toEqual(['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
    });
  });

  describe('function template', () => {
    it('should call the function with context and return HTML', () => {
      const template = jest.fn((ctx: { output: unknown }) => `<div>${JSON.stringify(ctx.output)}</div>`);

      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: { query: 'test' },
        output: { result: 42 },
        template,
      });

      expect(template).toHaveBeenCalled();
      expect(result.html).toContain('<div>');
      expect(result.uiType).toBe('html');
    });
  });

  describe('string template', () => {
    it('should wrap string in shell', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Static content</div>',
      });

      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<div>Static content</div>');
      expect(result.uiType).toBe('html');
    });
  });

  describe('platform-specific meta keys', () => {
    it('should use ui/html key for non-openai platform', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
        platformType: 'claude',
      });

      expect(result.meta).toHaveProperty('ui/html');
      expect(result.meta).not.toHaveProperty('openai/html');
    });

    it('should use ui/html key for openai platform (unified namespace)', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
        platformType: 'openai',
      });

      expect(result.meta).toHaveProperty('ui/html');
      expect(result.meta).not.toHaveProperty('openai/html');
    });
  });

  describe('widget sizing', () => {
    it('should carry sizing fields onto the response meta', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
        sizing: { preferredHeight: 420, minHeight: 100, maxHeight: 600, aspectRatio: '16 / 9' },
      });

      expect(result.meta).toHaveProperty('ui/preferredHeight', 420);
      expect(result.meta).toHaveProperty('ui/minHeight', 100);
      expect(result.meta).toHaveProperty('ui/maxHeight', 600);
      expect(result.meta).toHaveProperty('ui/aspectRatio', '16 / 9');
    });

    it('should only emit the sizing fields that are set', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
        sizing: { preferredHeight: '50vh' },
      });

      expect(result.meta).toHaveProperty('ui/preferredHeight', '50vh');
      expect(result.meta).not.toHaveProperty('ui/minHeight');
      expect(result.meta).not.toHaveProperty('ui/maxHeight');
      expect(result.meta).not.toHaveProperty('ui/aspectRatio');
    });

    it('should NOT emit sizing meta keys when no sizing configured', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
      });

      expect(result.meta).not.toHaveProperty('ui/preferredHeight');
      expect(result.meta).not.toHaveProperty('ui/minHeight');
      expect(result.meta).not.toHaveProperty('ui/maxHeight');
      expect(result.meta).not.toHaveProperty('ui/aspectRatio');
    });

    it('should inject sizing CSS + __mcpWidgetSizing into the rendered HTML', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
        sizing: { preferredHeight: 300 },
      });

      expect(result.html).toContain('window.__mcpWidgetSizing');
      expect(result.html).toContain('height: 300px;');
    });
  });

  describe('size and hash', () => {
    it('should return non-zero size', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
      });

      expect(result.size).toBeGreaterThan(0);
    });

    it('should return html string', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
      });

      expect(typeof result.html).toBe('string');
      expect(result.html.length).toBeGreaterThan(0);
    });
  });
});
