/**
 * @file dual-payload.test.ts
 * @description Tests for dual-payload builder for Claude Artifacts.
 *
 * The dual-payload format returns TWO TextContent blocks:
 * - Block 0: Pure JSON stringified data
 * - Block 1: Markdown-wrapped HTML (```html...```)
 */

import {
  buildDualPayload,
  isDualPayload,
  parseDualPayload,
  DEFAULT_HTML_PREFIX,
  type DualPayloadOptions,
  type DualPayloadResult,
} from '../dual-payload';

describe('Dual-Payload Builder', () => {
  describe('buildDualPayload', () => {
    it('should return two TextContent blocks', () => {
      const result = buildDualPayload({
        data: { key: 'value' },
        html: '<!DOCTYPE html><html></html>',
      });

      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('text');
      expect(result.content[1].type).toBe('text');
    });

    it('should have pure JSON in first block (no markdown)', () => {
      const result = buildDualPayload({
        data: { stock: 'AAPL', price: 150.25 },
        html: '<html></html>',
      });

      expect(result.content[0].text).toBe('{"stock":"AAPL","price":150.25}');
      // Should NOT contain markdown
      expect(result.content[0].text).not.toContain('```');
      expect(result.content[0].text).not.toContain('##');
    });

    it('should wrap HTML in markdown code block in second block', () => {
      const html = '<!DOCTYPE html><html><body>Test</body></html>';
      const result = buildDualPayload({
        data: {},
        html,
      });

      expect(result.content[1].text).toContain('```html');
      expect(result.content[1].text).toContain('<!DOCTYPE html>');
      expect(result.content[1].text).toContain('```');
    });

    it('should use default prefix', () => {
      const result = buildDualPayload({
        data: {},
        html: '<html></html>',
      });

      expect(result.content[1].text).toContain(DEFAULT_HTML_PREFIX + ':');
    });

    it('should use custom prefix', () => {
      const result = buildDualPayload({
        data: {},
        html: '<html></html>',
        htmlPrefix: 'Here is your weather dashboard',
      });

      expect(result.content[1].text).toContain('Here is your weather dashboard:');
      expect(result.content[1].text).not.toContain(DEFAULT_HTML_PREFIX);
    });

    it('should handle complex data structures', () => {
      const complexData = {
        stocks: [
          { symbol: 'AAPL', price: 150.25, change: '+1.2%' },
          { symbol: 'GOOGL', price: 2800.5, change: '-0.5%' },
        ],
        metadata: {
          timestamp: '2024-01-15T10:30:00Z',
          source: 'market-api',
        },
      };

      const result = buildDualPayload({
        data: complexData,
        html: '<html></html>',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.stocks).toHaveLength(2);
      expect(parsed.stocks[0].symbol).toBe('AAPL');
      expect(parsed.metadata.source).toBe('market-api');
    });

    it('should safely handle XSS attempts in HTML content', () => {
      const xssHtml = '<div><script>alert("xss")</script><img src=x onerror=alert(1)></div>';
      const result = buildDualPayload({
        data: { message: 'test' },
        html: xssHtml,
      });

      // The HTML is wrapped in code fence for display, not direct execution
      expect(result.content[1].text).toContain('```html');
      // Script tag should be preserved in code fence (display only)
      expect(result.content[1].text).toContain('<script>');
      // The HTML block should end with code fence closing
      expect(result.content[1].text).toMatch(/\n```$/);
    });

    it('should safely handle XSS attempts in data', () => {
      const xssData = {
        title: '<script>alert("xss")</script>',
        content: '<img src=x onerror="alert(1)">',
      };
      const result = buildDualPayload({
        data: xssData,
        html: '<html></html>',
      });

      // JSON encoding safely escapes special characters
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.title).toBe('<script>alert("xss")</script>');
      expect(parsed.content).toBe('<img src=x onerror="alert(1)">');
    });

    it('should handle null/undefined data gracefully', () => {
      const resultNull = buildDualPayload({
        data: null,
        html: '<html></html>',
      });
      expect(resultNull.content[0].text).toBe('{}');

      const resultUndefined = buildDualPayload({
        data: undefined,
        html: '<html></html>',
      });
      expect(resultUndefined.content[0].text).toBe('{}');
    });

    it('should escape triple backticks in HTML', () => {
      const htmlWithBackticks = '<pre>```javascript\nconst x = 1;\n```</pre>';
      const result = buildDualPayload({
        data: {},
        html: htmlWithBackticks,
      });

      // Should escape backticks to prevent breaking markdown
      expect(result.content[1].text).toContain('&#96;&#96;&#96;');
      expect(result.content[1].text).not.toContain('```javascript');
    });

    it('should preserve HTML content exactly (except backtick escaping)', () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 p-4">
  <div class="max-w-sm mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6">
    <h1 class="text-3xl font-bold text-gray-900">AAPL</h1>
    <p class="text-green-600">$150.25</p>
  </div>
</body>
</html>`;

      const result = buildDualPayload({
        data: { stock: 'AAPL' },
        html,
      });

      // Extract HTML from result
      const match = result.content[1].text.match(/```html\n([\s\S]*?)\n```/);
      expect(match).toBeTruthy();
      if (match) {
        expect(match[1]).toBe(html);
      }
    });
  });

  describe('isDualPayload', () => {
    it('should return true for valid dual-payload', () => {
      const validPayload = buildDualPayload({
        data: { test: true },
        html: '<html></html>',
      });

      expect(isDualPayload(validPayload)).toBe(true);
    });

    it('should return false for non-object', () => {
      expect(isDualPayload(null)).toBe(false);
      expect(isDualPayload(undefined)).toBe(false);
      expect(isDualPayload('string')).toBe(false);
      expect(isDualPayload(123)).toBe(false);
    });

    it('should return false for wrong content length', () => {
      expect(isDualPayload({ content: [] })).toBe(false);
      expect(isDualPayload({ content: [{ type: 'text', text: 'one' }] })).toBe(false);
      expect(
        isDualPayload({
          content: [
            { type: 'text', text: 'one' },
            { type: 'text', text: 'two' },
            { type: 'text', text: 'three' },
          ],
        }),
      ).toBe(false);
    });

    it('should return false for non-TextContent blocks', () => {
      expect(
        isDualPayload({
          content: [
            { type: 'image', data: 'base64' },
            { type: 'text', text: '```html\n<html></html>\n```' },
          ],
        }),
      ).toBe(false);
    });

    it('should return false if second block lacks HTML code fence', () => {
      expect(
        isDualPayload({
          content: [
            { type: 'text', text: '{}' },
            { type: 'text', text: 'No code fence here' },
          ],
        }),
      ).toBe(false);
    });
  });

  describe('parseDualPayload', () => {
    it('should extract data from first block', () => {
      const payload = buildDualPayload({
        data: { temperature: 72, conditions: 'sunny' },
        html: '<html></html>',
      });

      const { data } = parseDualPayload(payload);
      expect(data).toEqual({ temperature: 72, conditions: 'sunny' });
    });

    it('should extract HTML from second block', () => {
      const originalHtml = '<!DOCTYPE html><html><body>Content</body></html>';
      const payload = buildDualPayload({
        data: {},
        html: originalHtml,
      });

      const { html } = parseDualPayload(payload);
      expect(html).toBe(originalHtml);
    });

    it('should extract prefix from second block', () => {
      const payload = buildDualPayload({
        data: {},
        html: '<html></html>',
        htmlPrefix: 'Custom Prefix Here',
      });

      const { prefix } = parseDualPayload(payload);
      expect(prefix).toBe('Custom Prefix Here');
    });

    it('should handle malformed JSON in data block', () => {
      const malformedPayload: DualPayloadResult = {
        content: [
          { type: 'text', text: 'not valid json' },
          { type: 'text', text: '```html\n<html></html>\n```' },
        ],
      };

      const { data } = parseDualPayload(malformedPayload);
      expect(data).toBeNull();
    });

    it('should roundtrip correctly', () => {
      const originalData = { complex: { nested: { value: 42 } } };
      const originalHtml = '<div class="test">Test Content</div>';
      const originalPrefix = 'Test Result';

      const payload = buildDualPayload({
        data: originalData,
        html: originalHtml,
        htmlPrefix: originalPrefix,
      });

      const { data, html, prefix } = parseDualPayload(payload);

      expect(data).toEqual(originalData);
      expect(html).toBe(originalHtml);
      expect(prefix).toBe(originalPrefix);
    });
  });

  describe('Integration: Full dual-payload format', () => {
    it('should match expected Claude Artifacts format', () => {
      const result = buildDualPayload({
        data: { stock: 'AAPL', price: 150.25, change: '+1.2%' },
        html: `<!DOCTYPE html>
<html>
<head>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 p-10">
  <div class="max-w-sm mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6">
    <div class="uppercase tracking-wide text-sm text-indigo-500 font-semibold">Stock Update</div>
    <h1 class="text-3xl font-bold text-gray-900">AAPL</h1>
    <p class="mt-2 text-gray-500">Current Price: <span class="text-green-600 font-bold">$150.25</span></p>
    <p class="text-sm text-gray-400">Change: +1.2%</p>
  </div>
</body>
</html>`,
        htmlPrefix: 'Here is the visual dashboard',
      });

      // Verify structure
      expect(result.content).toHaveLength(2);

      // Block 0: Pure JSON
      const jsonBlock = result.content[0];
      expect(jsonBlock.type).toBe('text');
      const data = JSON.parse(jsonBlock.text);
      expect(data.stock).toBe('AAPL');
      expect(data.price).toBe(150.25);

      // Block 1: Markdown-wrapped HTML
      const htmlBlock = result.content[1];
      expect(htmlBlock.type).toBe('text');
      expect(htmlBlock.text).toMatch(/^Here is the visual dashboard:\n\n```html\n/);
      expect(htmlBlock.text).toContain('cdnjs.cloudflare.com');
      expect(htmlBlock.text).toContain('tailwindcss');
      expect(htmlBlock.text).toMatch(/\n```$/);
    });
  });
});
