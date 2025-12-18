/**
 * @file response-builder.test.ts
 * @description Tests for the tool response content builder.
 */

import { buildToolResponseContent, type BuildToolResponseOptions } from '../response-builder';
import type { AIPlatformType } from '../platform-meta';

describe('buildToolResponseContent', () => {
  const createOptions = (overrides: Partial<BuildToolResponseOptions> = {}): BuildToolResponseOptions => ({
    rawOutput: { temperature: 72, unit: 'F' },
    servingMode: 'inline',
    useStructuredContent: true,
    platformType: 'openai',
    ...overrides,
  });

  describe('static mode', () => {
    it('should return JSON-only content for static mode', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'static',
          platformType: 'openai',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.contentCleared).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should include structuredContent in static mode when useStructuredContent is true', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'static',
          platformType: 'openai',
          useStructuredContent: true,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should not include structuredContent in static mode when useStructuredContent is false', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'static',
          platformType: 'gemini',
          useStructuredContent: false,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.structuredContent).toBeUndefined();
    });

    it('should handle complex nested output in static mode', () => {
      const complexOutput = {
        users: [{ id: 1, name: 'Alice' }],
        meta: { page: 1 },
      };
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: complexOutput,
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(JSON.parse(result.content[0].text)).toEqual(complexOutput);
    });
  });

  describe('hybrid mode', () => {
    it('should return JSON-only content for hybrid mode', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'hybrid',
          platformType: 'openai',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.contentCleared).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should ignore htmlContent in hybrid mode', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'hybrid',
          htmlContent: '<div>Should be ignored</div>',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content[0].text).not.toContain('<div>');
    });

    it('should include structuredContent in hybrid mode when useStructuredContent is true', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'hybrid',
          platformType: 'openai',
          useStructuredContent: true,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
    });
  });

  describe('inline mode - structuredContent format', () => {
    const structuredContentPlatforms: AIPlatformType[] = [
      'openai',
      'ext-apps',
      'claude',
      'cursor',
      'continue',
      'cody',
      'generic-mcp',
    ];

    structuredContentPlatforms.forEach((platform) => {
      it(`should return structured-content format for ${platform} platform with HTML content`, () => {
        const result = buildToolResponseContent(
          createOptions({
            servingMode: 'inline',
            platformType: platform,
            useStructuredContent: true,
            htmlContent: '<!DOCTYPE html><html><body>Weather Widget</body></html>',
          }),
        );

        expect(result.format).toBe('structured-content');
        expect(result.contentCleared).toBe(false);
        expect(result.content).toHaveLength(1);

        // Single content block with raw HTML
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe('<!DOCTYPE html><html><body>Weather Widget</body></html>');

        // structuredContent contains the raw output
        expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
      });
    });

    it('should fallback to JSON-only when no HTML content', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useStructuredContent: true,
          htmlContent: undefined,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual({ temperature: 72, unit: 'F' });
      expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should fallback to JSON-only when HTML content is empty string', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useStructuredContent: true,
          htmlContent: '',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
    });
  });

  describe('inline mode - widget fallback (without structuredContent)', () => {
    it('should clear content for widget platforms when useStructuredContent is false', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'openai',
          useStructuredContent: false,
          htmlContent: '<div>Test</div>',
        }),
      );

      expect(result.format).toBe('widget');
      expect(result.contentCleared).toBe(true);
      expect(result.content).toEqual([]);
    });
  });

  describe('inline mode - markdown fallback', () => {
    // Only gemini and unknown don't support widgets in PLATFORM_CAPABILITIES
    const nonWidgetPlatforms: AIPlatformType[] = ['gemini', 'unknown'];

    nonWidgetPlatforms.forEach((platform) => {
      it(`should return markdown format for ${platform} platform with HTML`, () => {
        const result = buildToolResponseContent(
          createOptions({
            servingMode: 'inline',
            platformType: platform,
            useStructuredContent: false,
            htmlContent: '<div>Test Widget</div>',
          }),
        );

        expect(result.format).toBe('markdown');
        expect(result.contentCleared).toBe(false);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).toContain('## Data');
        expect(result.content[0].text).toContain('```json');
        expect(result.content[0].text).toContain('"temperature": 72');
        expect(result.content[0].text).toContain('## Visual Template');
        expect(result.content[0].text).toContain('```html');
        expect(result.content[0].text).toContain('<div>Test Widget</div>');
      });
    });

    it('should return JSON-only for non-widget platforms without HTML', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'gemini',
          useStructuredContent: false,
          htmlContent: undefined,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content).toHaveLength(1);
      // Pretty printed with 2 spaces for non-widget fallback
      expect(result.content[0].text).toContain('  "temperature"');
    });
  });

  describe('XSS prevention', () => {
    it('should pass HTML content as-is for structured-content format', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useStructuredContent: true,
          htmlContent: '<div><script>alert("xss")</script></div>',
        }),
      );

      expect(result.format).toBe('structured-content');
      // HTML should be included as-is (rendering is client-side in sandbox)
      expect(result.content[0].text).toContain('<script>');
    });

    it('should safely handle event handlers in htmlContent for non-widget platforms', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'gemini',
          useStructuredContent: false,
          htmlContent: '<img src=x onerror="alert(1)">',
        }),
      );

      expect(result.format).toBe('markdown');
      // Content is displayed in markdown code fence
      expect(result.content[0].text).toContain('onerror');
    });

    it('should safely handle script tags in rawOutput', () => {
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: { html: '<script>evil()</script>' },
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      // JSON encoding safely escapes the content
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.html).toBe('<script>evil()</script>');
    });
  });

  describe('edge cases', () => {
    it('should handle null rawOutput', () => {
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: null,
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content[0].text).toBe('null');
    });

    it('should handle array rawOutput', () => {
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: [1, 2, 3],
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
    });

    it('should handle string rawOutput', () => {
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: 'hello world',
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content[0].text).toBe('"hello world"');
    });

    it('should handle circular references in rawOutput gracefully', () => {
      const circular: Record<string, unknown> = { name: 'test' };
      // eslint-disable-next-line
      // @ts-ignore
      circular.self = circular;

      const result = buildToolResponseContent(
        createOptions({
          rawOutput: circular,
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content[0].text).toContain('[Circular]');
    });

    it('should handle empty object rawOutput', () => {
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: {},
          servingMode: 'static',
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content[0].text).toBe('{}');
    });
  });

  describe('meta property', () => {
    it('should not include meta property by default', () => {
      const result = buildToolResponseContent(createOptions());
      expect(result.meta).toBeUndefined();
    });

    it('should not modify rawOutput with _meta', () => {
      const outputWithMeta = {
        data: 'test',
        _meta: { 'ui/html': 'existing' },
      };
      const result = buildToolResponseContent(
        createOptions({
          rawOutput: outputWithMeta,
          servingMode: 'static',
        }),
      );

      // The rawOutput should be serialized as-is
      expect(JSON.parse(result.content[0].text)).toEqual(outputWithMeta);
    });
  });

  describe('content type property', () => {
    it('should always return text type for content blocks', () => {
      const scenarios = [
        { servingMode: 'static' as const, platformType: 'openai' as const },
        { servingMode: 'hybrid' as const, platformType: 'openai' as const },
        { servingMode: 'inline' as const, platformType: 'claude' as const, useStructuredContent: true },
        { servingMode: 'inline' as const, platformType: 'gemini' as const, useStructuredContent: false },
      ];

      scenarios.forEach((scenario) => {
        const result = buildToolResponseContent(
          createOptions({
            ...scenario,
            htmlContent: '<div>Test</div>',
          }),
        );

        result.content.forEach((block) => {
          expect(block.type).toBe('text');
        });
      });
    });
  });

  describe('structuredContent property', () => {
    it('should include structuredContent when useStructuredContent is true with HTML', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'openai',
          useStructuredContent: true,
          htmlContent: '<div>Test</div>',
        }),
      );

      expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should include structuredContent when useStructuredContent is true without HTML', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'openai',
          useStructuredContent: true,
          htmlContent: undefined,
        }),
      );

      expect(result.structuredContent).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should not include structuredContent when useStructuredContent is false', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'gemini',
          useStructuredContent: false,
          htmlContent: '<div>Test</div>',
        }),
      );

      expect(result.structuredContent).toBeUndefined();
    });
  });
});
