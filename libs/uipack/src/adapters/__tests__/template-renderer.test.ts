/**
 * Template Renderer Tests
 *
 * Tests for renderToolTemplate().
 */

import { renderToolTemplate } from '../template-renderer';

// Mock fs and esbuild for FileSource tests
jest.mock('fs', () => ({
  readFileSync: jest.fn(
    () => `
import React from 'react';
export default function Widget() {
  return <div>Hello</div>;
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

    it('should use openai/html key for openai platform', () => {
      const result = renderToolTemplate({
        toolName: 'test_tool',
        input: {},
        output: {},
        template: '<div>Hello</div>',
        platformType: 'openai',
      });

      expect(result.meta).toHaveProperty('openai/html');
      expect(result.meta).not.toHaveProperty('ui/html');
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
