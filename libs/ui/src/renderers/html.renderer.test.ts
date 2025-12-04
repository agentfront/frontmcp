/**
 * HTML Renderer Tests
 */

import { HtmlRenderer, htmlRenderer } from './html.renderer';
import type { TemplateContext } from '../runtime/types';
import { OPENAI_PLATFORM, CLAUDE_PLATFORM } from '../theme';

describe('HtmlRenderer', () => {
  let renderer: HtmlRenderer;
  const mockContext: TemplateContext<{}, { name: string }> = {
    input: {},
    output: { name: 'Test' },
    helpers: {
      escapeHtml: (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      formatDate: () => '',
      formatCurrency: () => '',
      uniqueId: () => 'unique-id',
      jsonEmbed: (d) => JSON.stringify(d),
    },
  };

  beforeEach(() => {
    renderer = new HtmlRenderer();
  });

  describe('type and priority', () => {
    it('should have type "html"', () => {
      expect(renderer.type).toBe('html');
    });

    it('should have priority 0 (fallback)', () => {
      expect(renderer.priority).toBe(0);
    });
  });

  describe('canHandle', () => {
    it('should handle string templates', () => {
      expect(renderer.canHandle('<div>hello</div>')).toBe(true);
      expect(renderer.canHandle('plain text')).toBe(true);
      expect(renderer.canHandle('')).toBe(true);
    });

    it('should handle function templates', () => {
      const fn = (ctx: any) => `<div>${ctx.output.name}</div>`;
      expect(renderer.canHandle(fn)).toBe(true);
    });

    it('should handle arrow function templates', () => {
      const arrow = () => '<div>hello</div>';
      expect(renderer.canHandle(arrow)).toBe(true);
    });

    it('should not handle non-string/non-function types', () => {
      expect(renderer.canHandle(123)).toBe(false);
      expect(renderer.canHandle(null)).toBe(false);
      expect(renderer.canHandle(undefined)).toBe(false);
      expect(renderer.canHandle({})).toBe(false);
      expect(renderer.canHandle([])).toBe(false);
    });
  });

  describe('transpile', () => {
    it('should return passthrough result for strings', async () => {
      const result = await renderer.transpile('<div>hello</div>');
      // HTML renderer returns empty code (no transpilation needed)
      expect(result.code).toBe('');
      expect(result.cached).toBe(true);
      expect(result.hash).toBeTruthy();
    });

    it('should return passthrough result for functions', async () => {
      const fn = () => '<div>hello</div>';
      const result = await renderer.transpile(fn);
      expect(result.code).toBe(''); // No transpiled code needed
      expect(result.cached).toBe(true);
    });

    it('should generate consistent hash for same input', async () => {
      const result1 = await renderer.transpile('<div>hello</div>');
      const result2 = await renderer.transpile('<div>hello</div>');
      expect(result1.hash).toBe(result2.hash);
    });

    it('should generate different hash for different input', async () => {
      const result1 = await renderer.transpile('<div>hello</div>');
      const result2 = await renderer.transpile('<div>world</div>');
      expect(result1.hash).not.toBe(result2.hash);
    });
  });

  describe('render', () => {
    it('should render string templates directly', async () => {
      const template = '<div>Hello World</div>';
      const result = await renderer.render(template, mockContext);
      expect(result).toBe('<div>Hello World</div>');
    });

    it('should execute function templates with context', async () => {
      const template = (ctx: TemplateContext<{}, { name: string }>) => `<div>Hello ${ctx.output.name}</div>`;
      const result = await renderer.render(template, mockContext);
      expect(result).toBe('<div>Hello Test</div>');
    });

    it('should provide helpers to template functions', async () => {
      const template = (ctx: TemplateContext<{}, { name: string }>) =>
        `<div>${ctx.helpers.escapeHtml('<script>')}</div>`;
      const result = await renderer.render(template, mockContext);
      expect(result).toBe('<div>&lt;script&gt;</div>');
    });

    it('should provide input to template functions', async () => {
      const contextWithInput: TemplateContext<{ query: string }, {}> = {
        ...mockContext,
        input: { query: 'test' },
        output: {},
      };
      const template = (ctx: TemplateContext<{ query: string }, {}>) => `<div>Query: ${ctx.input.query}</div>`;
      const result = await renderer.render(template, contextWithInput);
      expect(result).toBe('<div>Query: test</div>');
    });

    it('should provide structuredContent to template functions', async () => {
      const contextWithStructured: TemplateContext<{}, {}> = {
        ...mockContext,
        structuredContent: { items: [1, 2, 3] },
      };
      const template = (ctx: TemplateContext<{}, {}>) => `<div>Items: ${JSON.stringify(ctx.structuredContent)}</div>`;
      const result = await renderer.render(template, contextWithStructured);
      expect(result).toContain('Items:');
      expect(result).toContain('[1,2,3]');
    });

    it('should handle empty string templates', async () => {
      const result = await renderer.render('', mockContext);
      expect(result).toBe('');
    });

    it('should handle multiline templates', async () => {
      const template = `
        <div>
          <h1>Title</h1>
          <p>Content</p>
        </div>
      `;
      const result = await renderer.render(template, mockContext);
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<p>Content</p>');
    });
  });

  describe('getRuntimeScripts', () => {
    it('should return empty scripts for HTML renderer', () => {
      const scripts = renderer.getRuntimeScripts(OPENAI_PLATFORM);
      expect(scripts.headScripts).toBe('');
      expect(scripts.isInline).toBe(false);
    });

    it('should return empty scripts for Claude platform', () => {
      const scripts = renderer.getRuntimeScripts(CLAUDE_PLATFORM);
      expect(scripts.headScripts).toBe('');
      expect(scripts.isInline).toBe(false);
    });

    it('should not include inline scripts', () => {
      const scripts = renderer.getRuntimeScripts(OPENAI_PLATFORM);
      expect(scripts.inlineScripts).toBeUndefined();
    });
  });
});

describe('htmlRenderer singleton', () => {
  it('should be an instance of HtmlRenderer', () => {
    expect(htmlRenderer).toBeInstanceOf(HtmlRenderer);
  });

  it('should have type "html"', () => {
    expect(htmlRenderer.type).toBe('html');
  });
});
