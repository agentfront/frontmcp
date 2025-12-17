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
    useDualPayload: false,
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
  });

  describe('inline mode - widget platforms', () => {
    const widgetPlatforms: AIPlatformType[] = ['openai', 'ext-apps', 'cursor'];

    widgetPlatforms.forEach((platform) => {
      it(`should clear content for ${platform} platform`, () => {
        const result = buildToolResponseContent(
          createOptions({
            servingMode: 'inline',
            platformType: platform,
            htmlContent: '<div>Test</div>',
          }),
        );

        expect(result.format).toBe('widget');
        expect(result.contentCleared).toBe(true);
        expect(result.content).toEqual([]);
      });
    });

    it('should clear content even without htmlContent on widget platforms', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'openai',
          htmlContent: undefined,
        }),
      );

      expect(result.format).toBe('widget');
      expect(result.contentCleared).toBe(true);
    });
  });

  describe('inline mode - dual-payload (Claude)', () => {
    it('should return dual-payload format for Claude with HTML content', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useDualPayload: true,
          htmlContent: '<div>Weather Widget</div>',
        }),
      );

      expect(result.format).toBe('dual-payload');
      expect(result.contentCleared).toBe(false);
      expect(result.content).toHaveLength(2);

      // First block: JSON data
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual({ temperature: 72, unit: 'F' });

      // Second block: HTML with prefix
      expect(result.content[1].type).toBe('text');
      expect(result.content[1].text).toContain('Here is the visual result');
      expect(result.content[1].text).toContain('<div>Weather Widget</div>');
    });

    it('should use custom HTML prefix when provided', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useDualPayload: true,
          htmlContent: '<div>Chart</div>',
          htmlPrefix: 'Here is your chart',
        }),
      );

      expect(result.format).toBe('dual-payload');
      expect(result.content[1].text).toContain('Here is your chart');
    });

    it('should fallback to JSON-only when no HTML content', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useDualPayload: true,
          htmlContent: undefined,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual({ temperature: 72, unit: 'F' });
    });

    it('should fallback to JSON-only when HTML content is empty string', () => {
      const result = buildToolResponseContent(
        createOptions({
          servingMode: 'inline',
          platformType: 'claude',
          useDualPayload: true,
          htmlContent: '',
        }),
      );

      expect(result.format).toBe('json-only');
    });
  });

  describe('inline mode - markdown fallback', () => {
    const nonWidgetPlatforms: AIPlatformType[] = ['gemini', 'unknown', 'continue', 'cody', 'generic-mcp'];

    nonWidgetPlatforms.forEach((platform) => {
      it(`should return markdown format for ${platform} platform with HTML`, () => {
        const result = buildToolResponseContent(
          createOptions({
            servingMode: 'inline',
            platformType: platform,
            useDualPayload: false,
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
          useDualPayload: false,
          htmlContent: undefined,
        }),
      );

      expect(result.format).toBe('json-only');
      expect(result.content).toHaveLength(1);
      // Pretty printed with 2 spaces for non-widget fallback
      expect(result.content[0].text).toContain('  "temperature"');
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
        { servingMode: 'inline' as const, platformType: 'claude' as const, useDualPayload: true },
        { servingMode: 'inline' as const, platformType: 'gemini' as const },
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
});
