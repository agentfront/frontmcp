/**
 * Template Processor Tests
 *
 * Tests for multi-format template processing pipelines.
 */

import {
  processTemplate,
  processTemplates,
  supportsHandlebars,
  producesHtml,
  requiresBundling,
  processHtmlTemplate,
  clearHandlebarsCache,
} from '../template-processor';
import type { ResolvedTemplate, TemplateProcessingOptions } from '../types';

describe('processTemplate', () => {
  beforeEach(() => {
    clearHandlebarsCache();
  });

  describe('HTML format', () => {
    it('should process plain HTML without Handlebars', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '<div>Hello World</div>' },
        format: 'html',
        content: '<div>Hello World</div>',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: { input: {}, output: {} },
      };

      const result = await processTemplate(resolved, options);

      expect(result.format).toBe('html');
      expect(result.html).toBe('<div>Hello World</div>');
      expect(result.needsBundling).toBeUndefined();
    });

    it('should process HTML with Handlebars expressions', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '<div>Hello {{output.name}}</div>' },
        format: 'html',
        content: '<div>Hello {{output.name}}</div>',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: {
          input: {},
          output: { name: 'World' },
        },
      };

      const result = await processTemplate(resolved, options);

      expect(result.format).toBe('html');
      expect(result.html).toBe('<div>Hello World</div>');
    });

    it('should handle nested Handlebars paths', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '<p>{{output.user.firstName}} {{output.user.lastName}}</p>' },
        format: 'html',
        content: '<p>{{output.user.firstName}} {{output.user.lastName}}</p>',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: {
          input: {},
          output: { user: { firstName: 'John', lastName: 'Doe' } },
        },
      };

      const result = await processTemplate(resolved, options);

      expect(result.html).toBe('<p>John Doe</p>');
    });

    it('should handle Handlebars #if conditionals', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '{{#if output.show}}<div>Visible</div>{{/if}}' },
        format: 'html',
        content: '{{#if output.show}}<div>Visible</div>{{/if}}',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: {
          input: {},
          output: { show: true },
        },
      };

      const result = await processTemplate(resolved, options);
      expect(result.html).toBe('<div>Visible</div>');

      // Test with false condition
      const options2: TemplateProcessingOptions = {
        context: {
          input: {},
          output: { show: false },
        },
      };

      const result2 = await processTemplate(resolved, options2);
      expect(result2.html).toBe('');
    });

    it('should handle Handlebars #each loops', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '<ul>{{#each output.items}}<li>{{this}}</li>{{/each}}</ul>' },
        format: 'html',
        content: '<ul>{{#each output.items}}<li>{{this}}</li>{{/each}}</ul>',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: {
          input: {},
          output: { items: ['Apple', 'Banana', 'Cherry'] },
        },
      };

      const result = await processTemplate(resolved, options);
      expect(result.html).toBe('<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>');
    });
  });

  describe('React format', () => {
    it('should return code without processing for React templates', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'file', path: './component.tsx' },
        format: 'react',
        content: 'export default function Component({ input, output }) { return <div>{output.name}</div>; }',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: { input: {}, output: { name: 'Test' } },
      };

      const result = await processTemplate(resolved, options);

      expect(result.format).toBe('react');
      expect(result.code).toBe(resolved.content);
      expect(result.needsBundling).toBe(true);
      expect(result.html).toBeUndefined();
    });

    it('should not apply Handlebars to React templates', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'file', path: './component.tsx' },
        format: 'react',
        content: 'const name = "{{output.name}}"; // This is intentional string literal',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: { input: {}, output: { name: 'Test' } },
      };

      const result = await processTemplate(resolved, options);

      // React templates should NOT process Handlebars - data comes via props
      expect(result.code).toContain('{{output.name}}');
      expect(result.needsBundling).toBe(true);
    });
  });

  describe('input context', () => {
    it('should provide access to input context', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '<div>Query: {{input.query}}</div>' },
        format: 'html',
        content: '<div>Query: {{input.query}}</div>',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: {
          input: { query: 'test search' },
          output: {},
        },
      };

      const result = await processTemplate(resolved, options);
      expect(result.html).toBe('<div>Query: test search</div>');
    });

    it('should provide access to structuredContent', async () => {
      const resolved: ResolvedTemplate = {
        source: { type: 'inline', content: '<div>{{structuredContent.title}}</div>' },
        format: 'html',
        content: '<div>{{structuredContent.title}}</div>',
        hash: 'abc123',
      };

      const options: TemplateProcessingOptions = {
        context: {
          input: {},
          output: {},
          structuredContent: { title: 'Structured Data' },
        },
      };

      const result = await processTemplate(resolved, options);
      expect(result.html).toBe('<div>Structured Data</div>');
    });
  });
});

describe('processTemplates', () => {
  beforeEach(() => {
    clearHandlebarsCache();
  });

  it('should process multiple templates in parallel', async () => {
    const items = [
      {
        resolved: {
          source: { type: 'inline' as const, content: '<p>{{output.a}}</p>' },
          format: 'html' as const,
          content: '<p>{{output.a}}</p>',
          hash: 'hash1',
        },
        options: { context: { input: {}, output: { a: 'First' } } },
      },
      {
        resolved: {
          source: { type: 'inline' as const, content: '<p>{{output.b}}</p>' },
          format: 'html' as const,
          content: '<p>{{output.b}}</p>',
          hash: 'hash2',
        },
        options: { context: { input: {}, output: { b: 'Second' } } },
      },
    ];

    const results = await processTemplates(items);

    expect(results).toHaveLength(2);
    expect(results[0].html).toBe('<p>First</p>');
    expect(results[1].html).toBe('<p>Second</p>');
  });
});

describe('supportsHandlebars', () => {
  it('should return true for html format', () => {
    expect(supportsHandlebars('html')).toBe(true);
  });

  it('should return true for markdown format', () => {
    expect(supportsHandlebars('markdown')).toBe(true);
  });

  it('should return true for mdx format', () => {
    expect(supportsHandlebars('mdx')).toBe(true);
  });

  it('should return false for react format', () => {
    expect(supportsHandlebars('react')).toBe(false);
  });
});

describe('producesHtml', () => {
  it('should return true for html format', () => {
    expect(producesHtml('html')).toBe(true);
  });

  it('should return true for markdown format', () => {
    expect(producesHtml('markdown')).toBe(true);
  });

  it('should return true for mdx format', () => {
    expect(producesHtml('mdx')).toBe(true);
  });

  it('should return false for react format', () => {
    expect(producesHtml('react')).toBe(false);
  });
});

describe('requiresBundling', () => {
  it('should return false for html format', () => {
    expect(requiresBundling('html')).toBe(false);
  });

  it('should return false for markdown format', () => {
    expect(requiresBundling('markdown')).toBe(false);
  });

  it('should return false for mdx format', () => {
    expect(requiresBundling('mdx')).toBe(false);
  });

  it('should return true for react format', () => {
    expect(requiresBundling('react')).toBe(true);
  });
});

describe('processHtmlTemplate', () => {
  beforeEach(() => {
    clearHandlebarsCache();
  });

  it('should process plain HTML without Handlebars', async () => {
    const result = await processHtmlTemplate('<div>Hello</div>', { input: {}, output: {} });
    expect(result).toBe('<div>Hello</div>');
  });

  it('should process HTML with Handlebars', async () => {
    const result = await processHtmlTemplate('<div>{{output.message}}</div>', {
      input: {},
      output: { message: 'Hello World' },
    });
    expect(result).toBe('<div>Hello World</div>');
  });

  it('should skip Handlebars for content without expressions', async () => {
    const result = await processHtmlTemplate('<div>No expressions here</div>', { input: {}, output: {} });
    expect(result).toBe('<div>No expressions here</div>');
  });
});

describe('edge cases', () => {
  beforeEach(() => {
    clearHandlebarsCache();
  });

  it('should handle empty template content', async () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'inline', content: '' },
      format: 'html',
      content: '',
      hash: 'empty',
    };

    const result = await processTemplate(resolved, { context: { input: {}, output: {} } });
    expect(result.html).toBe('');
  });

  it('should handle template with only whitespace', async () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'inline', content: '   \n\t  ' },
      format: 'html',
      content: '   \n\t  ',
      hash: 'whitespace',
    };

    const result = await processTemplate(resolved, { context: { input: {}, output: {} } });
    expect(result.html).toBe('   \n\t  ');
  });

  it('should handle missing output values gracefully', async () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'inline', content: '<div>{{output.missing}}</div>' },
      format: 'html',
      content: '<div>{{output.missing}}</div>',
      hash: 'missing',
    };

    const result = await processTemplate(resolved, { context: { input: {}, output: {} } });
    // Handlebars renders undefined/missing as empty string
    expect(result.html).toBe('<div></div>');
  });

  it('should handle special HTML characters in output', async () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'inline', content: '<div>{{{output.html}}}</div>' },
      format: 'html',
      content: '<div>{{{output.html}}}</div>',
      hash: 'special',
    };

    const result = await processTemplate(resolved, {
      context: {
        input: {},
        output: { html: '<strong>Bold</strong>' },
      },
    });
    // Triple braces in Handlebars disable HTML escaping
    expect(result.html).toBe('<div><strong>Bold</strong></div>');
  });

  it('should escape HTML by default with double braces', async () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'inline', content: '<div>{{output.html}}</div>' },
      format: 'html',
      content: '<div>{{output.html}}</div>',
      hash: 'escape',
    };

    const result = await processTemplate(resolved, {
      context: {
        input: {},
        output: { html: '<script>alert("xss")</script>' },
      },
    });
    // Double braces escape HTML
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).not.toContain('<script>');
  });
});
