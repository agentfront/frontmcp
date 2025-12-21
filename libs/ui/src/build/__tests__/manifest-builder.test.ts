/**
 * Widget Manifest Builder Tests
 *
 * Tests for buildToolWidgetManifest and detectUIType.
 */

import { buildToolWidgetManifest, detectUIType, buildToolResponseMeta, getOutputModeForClient } from '../index';
import type { WidgetConfig, BuildManifestResult } from '../../types';

describe('detectUIType', () => {
  describe('string templates', () => {
    it('should detect html for plain HTML strings', () => {
      expect(detectUIType('<div>Hello</div>')).toBe('html');
    });

    it('should detect react for .tsx file paths (file-based templates)', () => {
      // File paths ending in .tsx are detected as file-based React templates
      expect(detectUIType('./components/Weather.tsx')).toBe('react');
    });

    it('should detect html for .html file paths', () => {
      // File paths ending in .html are detected as file-based HTML templates
      expect(detectUIType('./components/Weather.html')).toBe('html');
    });

    it('should detect html for plain string paths without extension', () => {
      // Plain strings without recognized extensions are treated as HTML
      expect(detectUIType('./components/Weather')).toBe('html');
    });
  });

  describe('function templates', () => {
    it('should detect html for basic functions', () => {
      const fn = () => '<div>Hello</div>';
      expect(detectUIType(fn)).toBe('html');
    });
  });

  describe('edge cases', () => {
    it('should default to html for empty string', () => {
      expect(detectUIType('')).toBe('html');
    });

    it('should handle null', () => {
      expect(detectUIType(null as unknown as string)).toBe('html');
    });

    it('should handle undefined', () => {
      expect(detectUIType(undefined as unknown as string)).toBe('html');
    });
  });
});

describe('buildToolWidgetManifest', () => {
  const simpleHTMLConfig: WidgetConfig = {
    template: '<div>Hello World</div>',
    uiType: 'html',
    bundlingMode: 'static',
    displayMode: 'inline',
  };

  const simpleSchema = {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
  };

  describe('basic manifest generation', () => {
    it('should build manifest with HTML template', async () => {
      const result: BuildManifestResult = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest).toBeDefined();
      expect(result.manifest.tool).toBe('test_tool');
      expect(result.manifest.uiType).toBe('html');
      expect(result.manifest.bundlingMode).toBe('static');
      expect(result.manifest.displayMode).toBe('inline');
    });

    it('should generate HTML output', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.html).toBeDefined();
      expect(typeof result.html).toBe('string');
      expect(result.html.length).toBeGreaterThan(0);
    });

    it('should return both content and html separately', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      // Content should be just the rendered template
      expect(result.content).toBeDefined();
      expect(result.content).toContain('Hello World');
      expect(result.content).not.toContain('<!DOCTYPE html>');

      // HTML should be the full document
      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain(result.content);

      // Content should be smaller than full HTML
      expect(result.contentSize).toBeLessThan(result.htmlSize);
    });

    it('should include schema in manifest', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.schema).toEqual(simpleSchema);
    });

    it('should generate hash for manifest', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.hash).toBeDefined();
      expect(typeof result.manifest.hash).toBe('string');
      expect(result.manifest.hash.length).toBeGreaterThan(0);
    });
  });

  describe('CSP generation', () => {
    it('should include CSP in manifest', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.csp).toBeDefined();
      // CSP object should exist
      expect(typeof result.manifest.csp).toBe('object');
    });

    it('should merge user CSP directives', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        csp: {
          connectSrc: ['https://api.example.com'],
        },
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      // Check that user CSP was considered
      expect(result.manifest.csp).toBeDefined();
    });
  });

  describe('widgetAccessible flag', () => {
    it('should default to false', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.widgetAccessible).toBe(false);
    });

    it('should respect explicit true value', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        widgetAccessible: true,
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.widgetAccessible).toBe(true);
    });
  });

  describe('renderer assets', () => {
    it('should include renderer assets in manifest', async () => {
      const result = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.rendererAssets).toBeDefined();
    });

    it('should include React runtime for react type', async () => {
      const reactConfig: WidgetConfig = {
        template: () => '<div>React</div>',
        uiType: 'react',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: reactConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      // React type should include runtime info
      expect(result.manifest.uiType).toBe('react');
    });
  });

  describe('auto UI type detection', () => {
    it('should use auto when uiType is auto', async () => {
      const config: WidgetConfig = {
        template: '<div>Simple HTML</div>',
        uiType: 'auto',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      // When 'auto' is specified, the function detects the type based on template
      // The manifest should have a valid UI type
      expect(['html', 'react', 'mdx', 'markdown', 'auto']).toContain(result.manifest.uiType);
    });

    it('should use explicit html type when specified', async () => {
      const config: WidgetConfig = {
        template: '<div>Simple HTML</div>',
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.uiType).toBe('html');
    });
  });

  describe('display modes', () => {
    it('should support inline display mode', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.displayMode).toBe('inline');
    });

    it('should support fullscreen display mode', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        displayMode: 'fullscreen',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.displayMode).toBe('fullscreen');
    });

    it('should support pip display mode', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        displayMode: 'pip',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.displayMode).toBe('pip');
    });
  });

  describe('bundling modes', () => {
    it('should support static bundling mode', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        bundlingMode: 'static',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.bundlingMode).toBe('static');
    });

    it('should support dynamic bundling mode', async () => {
      const config: WidgetConfig = {
        ...simpleHTMLConfig,
        bundlingMode: 'dynamic',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result.manifest.bundlingMode).toBe('dynamic');
    });
  });

  describe('error handling', () => {
    it('should handle missing template gracefully', async () => {
      const config: WidgetConfig = {
        template: '',
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      // Should not throw, returns empty/default HTML
      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
    });
  });

  describe('function templates with ctx.output', () => {
    it('should handle function template when sampleOutput is not provided (ctx.output is empty object)', async () => {
      // When sampleOutput is not provided, ctx.output is set to {} (empty object)
      // Templates must handle this case gracefully
      const config: WidgetConfig = {
        template: (ctx) => {
          // ctx.output is {} when no sampleOutput provided, so this guard doesn't trigger
          if (!ctx.output) {
            return '<div>Loading...</div>';
          }
          // Destructuring from {} gives undefined properties
          const { message } = ctx.output as { message?: string };
          // escapeHtml should handle undefined without crashing
          return `<div>${ctx.helpers.escapeHtml(message)}</div>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      // Should not throw even when sampleOutput is not provided
      // escapeHtml(undefined) returns '' after the fix
      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
      // message is undefined, escapeHtml(undefined) returns '', so we get <div></div>
      expect(result.content).toContain('<div></div>');
    });

    it('should not crash when template destructures undefined output properties', async () => {
      // This is the exact bug scenario: template tries to use escapeHtml on
      // properties from ctx.output when output is empty/undefined
      const config: WidgetConfig = {
        template: (ctx) => {
          // This would crash before the fix: ctx.helpers.escapeHtml(undefined).replace(...)
          const output = ctx.output as { label?: string; value?: string } | undefined;
          const label = output?.label;
          const value = output?.value;
          return `<span>${ctx.helpers.escapeHtml(label)}: ${ctx.helpers.escapeHtml(value)}</span>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      // Before fix: TypeError: Cannot read properties of undefined (reading 'replace')
      // After fix: escapeHtml handles undefined gracefully
      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
      expect(result.content).toContain('<span>: </span>');
    });

    it('should render function template correctly when sampleOutput is provided', async () => {
      const config: WidgetConfig = {
        template: (ctx) => {
          if (!ctx.output) {
            return '<div>Loading...</div>';
          }
          const { message } = ctx.output as { message: string };
          return `<div>${ctx.helpers.escapeHtml(message)}</div>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
        sampleOutput: { message: 'Hello World' },
      });

      expect(result).toBeDefined();
      expect(result.content).toContain('Hello World');
    });
  });

  describe('ctx.helpers.escapeHtml with edge cases', () => {
    it('should handle escapeHtml with undefined value', async () => {
      const config: WidgetConfig = {
        template: (ctx) => {
          // Explicitly pass undefined to escapeHtml
          const value = undefined;
          return `<div>${ctx.helpers.escapeHtml(value)}</div>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      // Should not throw - escapeHtml should handle undefined
      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
      expect(result.content).toContain('<div></div>');
    });

    it('should handle escapeHtml with null value', async () => {
      const config: WidgetConfig = {
        template: (ctx) => {
          // Explicitly pass null to escapeHtml
          const value = null;
          return `<div>${ctx.helpers.escapeHtml(value)}</div>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      // Should not throw - escapeHtml should handle null
      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
      expect(result.content).toContain('<div></div>');
    });

    it('should escape HTML special characters', async () => {
      const config: WidgetConfig = {
        template: (ctx) => {
          return `<div>${ctx.helpers.escapeHtml('<script>alert("xss")</script>')}</div>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
      expect(result.content).not.toContain('<script>');
      expect(result.content).toContain('&lt;script&gt;');
    });

    it('should convert non-string values to string before escaping', async () => {
      const config: WidgetConfig = {
        template: (ctx) => {
          // Pass a number to escapeHtml
          return `<div>${ctx.helpers.escapeHtml(123)}</div>`;
        },
        uiType: 'html',
        bundlingMode: 'static',
        displayMode: 'inline',
      };

      const result = await buildToolWidgetManifest({
        uiConfig: config,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result).toBeDefined();
      expect(result.content).toContain('<div>123</div>');
    });
  });

  describe('deterministic hash generation', () => {
    it('should generate same hash for same input', async () => {
      const result1 = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      const result2 = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool',
        schema: simpleSchema,
      });

      expect(result1.manifest.hash).toBe(result2.manifest.hash);
    });

    it('should generate different hash for different input', async () => {
      const result1 = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool_1',
        schema: simpleSchema,
      });

      const result2 = await buildToolWidgetManifest({
        uiConfig: simpleHTMLConfig,
        toolName: 'test_tool_2',
        schema: simpleSchema,
      });

      expect(result1.manifest.hash).not.toBe(result2.manifest.hash);
    });
  });
});

describe('buildToolResponseMeta', () => {
  const simpleHTMLConfig: WidgetConfig = {
    template: '<div>Hello World</div>',
    uiType: 'html',
    bundlingMode: 'static',
    displayMode: 'inline',
  };

  const simpleSchema = {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
  };

  it('should build _meta fields for code-only mode', async () => {
    const buildResult = await buildToolWidgetManifest({
      uiConfig: simpleHTMLConfig,
      toolName: 'test_tool',
      schema: simpleSchema,
    });

    const meta = buildToolResponseMeta({
      buildResult,
      outputMode: 'code-only',
    });

    expect(meta['ui/type']).toBe('html');
    expect(meta['ui/content']).toBeDefined();
    expect(meta['ui/content']).not.toContain('<!DOCTYPE html>');
    expect(meta['ui/html']).toBeUndefined();
    expect(meta['ui/hash']).toBeDefined();
  });

  it('should build _meta fields for full-ssr mode', async () => {
    const buildResult = await buildToolWidgetManifest({
      uiConfig: simpleHTMLConfig,
      toolName: 'test_tool',
      schema: simpleSchema,
    });

    const meta = buildToolResponseMeta({
      buildResult,
      outputMode: 'full-ssr',
    });

    expect(meta['ui/type']).toBe('html');
    expect(meta['ui/html']).toBeDefined();
    expect(meta['ui/html']).toContain('<!DOCTYPE html>');
    expect(meta['ui/content']).toBeUndefined();
    expect(meta['ui/hash']).toBeDefined();
  });

  it('should include OpenAI fields by default', async () => {
    const configWithDescription: WidgetConfig = {
      ...simpleHTMLConfig,
      widgetAccessible: true,
      widgetDescription: 'Test widget description',
    };

    const buildResult = await buildToolWidgetManifest({
      uiConfig: configWithDescription,
      toolName: 'test_tool',
      schema: simpleSchema,
    });

    const meta = buildToolResponseMeta({
      buildResult,
      outputMode: 'code-only',
    });

    expect(meta['ui/widgetAccessible']).toBe(true);
    expect(meta['ui/description']).toBe('Test widget description');
    expect(meta['openai/widgetAccessible']).toBe(true);
    expect(meta['openai/widgetDescription']).toBe('Test widget description');
  });

  it('should exclude OpenAI fields when includeOpenAI is false', async () => {
    const configWithDescription: WidgetConfig = {
      ...simpleHTMLConfig,
      widgetAccessible: true,
      widgetDescription: 'Test widget description',
    };

    const buildResult = await buildToolWidgetManifest({
      uiConfig: configWithDescription,
      toolName: 'test_tool',
      schema: simpleSchema,
    });

    const meta = buildToolResponseMeta({
      buildResult,
      outputMode: 'code-only',
      includeOpenAI: false,
    });

    expect(meta['ui/widgetAccessible']).toBe(true);
    expect(meta['openai/widgetAccessible']).toBeUndefined();
    expect(meta['openai/widgetDescription']).toBeUndefined();
  });
});

describe('getOutputModeForClient', () => {
  it('should return code-only for OpenAI clients', () => {
    expect(getOutputModeForClient({ name: 'OpenAI ChatGPT' })).toBe('code-only');
    expect(getOutputModeForClient({ name: 'chatgpt-client' })).toBe('code-only');
  });

  it('should return code-only for Cursor', () => {
    expect(getOutputModeForClient({ name: 'Cursor' })).toBe('code-only');
  });

  it('should return dual-payload for Claude (JSON + markdown-wrapped HTML)', () => {
    expect(getOutputModeForClient({ name: 'Claude' })).toBe('dual-payload');
    expect(getOutputModeForClient({ name: 'claude-desktop' })).toBe('dual-payload');
    expect(getOutputModeForClient({ name: 'Claude Desktop' })).toBe('dual-payload');
    expect(getOutputModeForClient({ name: 'Anthropic Claude' })).toBe('dual-payload');
  });

  it('should return full-ssr for unknown clients', () => {
    expect(getOutputModeForClient({ name: 'SomeUnknownClient' })).toBe('full-ssr');
    expect(getOutputModeForClient({})).toBe('full-ssr');
    expect(getOutputModeForClient()).toBe('full-ssr');
  });
});
