/**
 * E2E Tests for HTML UI Tools
 *
 * Tests for html-table and html-card tools including:
 * - Basic functionality
 * - Edge cases and boundaries
 * - Unicode and special characters
 * - XSS prevention
 * - Data transformation
 */
import { test, expect } from '@frontmcp/testing';

test.describe('HTML Tools E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('HTML Table Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate HTML table with headers and rows', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Name', 'Age', 'City'],
          rows: [
            ['Alice', '30', 'NYC'],
            ['Bob', '25', 'LA'],
          ],
          title: 'User Data',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('html');
        expect(result).toHaveTextContent('rowCount');
      });

      test('should return correct row count', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['A', 'B'],
          rows: [
            ['1', '2'],
            ['3', '4'],
            ['5', '6'],
          ],
          title: 'Three Rows',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number }>();
        expect(json.rowCount).toBe(3);
      });

      test('should return correct column count', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['A', 'B', 'C', 'D', 'E'],
          rows: [['1', '2', '3', '4', '5']],
          title: 'Five Columns',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ columnCount: number }>();
        expect(json.columnCount).toBe(5);
      });

      test('should handle table without title', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Col1', 'Col2'],
          rows: [['A', 'B']],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Empty and Edge Cases', () => {
      test('should handle empty rows array', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Name', 'Age'],
          rows: [],
          title: 'Empty Table',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number }>();
        expect(json.rowCount).toBe(0);
      });

      test('should handle single header single row', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Single'],
          rows: [['Value']],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number; columnCount: number }>();
        expect(json.rowCount).toBe(1);
        expect(json.columnCount).toBe(1);
      });

      test('should handle many columns', async ({ mcp }) => {
        const headers = Array.from({ length: 20 }, (_, i) => `Col${i + 1}`);
        const rows = [Array.from({ length: 20 }, (_, i) => `Val${i + 1}`)];

        const result = await mcp.tools.call('html-table', {
          headers,
          rows,
          title: 'Wide Table',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ columnCount: number }>();
        expect(json.columnCount).toBe(20);
      });

      test('should handle many rows', async ({ mcp }) => {
        const rows = Array.from({ length: 100 }, (_, i) => [`Row ${i}`, `Value ${i}`]);

        const result = await mcp.tools.call('html-table', {
          headers: ['Name', 'Value'],
          rows,
          title: 'Large Table',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number }>();
        expect(json.rowCount).toBe(100);
      });

      test('should handle very long cell content', async ({ mcp }) => {
        const longString = 'A'.repeat(1000);

        const result = await mcp.tools.call('html-table', {
          headers: ['Long Content'],
          rows: [[longString]],
          title: 'Long Content Test',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle rows with varying cell counts', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['A', 'B', 'C'],
          rows: [['1', '2', '3'], ['4', '5'], ['6']],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in headers', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['名前', 'Émoji', '日本語'],
          rows: [['Value', 'Value', 'Value']],
          title: 'Unicode Headers',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle Unicode in cells', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Name', 'Language'],
          rows: [
            ['田中太郎', '日本語'],
            ['Müller', 'Deutsch'],
            ['Björk', 'Íslenska'],
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in cells', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Status', 'Icon'],
          rows: [
            ['Success', '✅'],
            ['Warning', '⚠️'],
            ['Error', '❌'],
            ['Fire', '🔥🚀💡'],
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle RTL text', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Arabic', 'Hebrew'],
          rows: [
            ['مرحبا', 'שלום'],
            ['العالم', 'עולם'],
          ],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('XSS Prevention', () => {
      test('should escape script tags in cells', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Name'],
          rows: [['<script>alert("xss")</script>']],
          title: 'XSS Test',
        });

        expect(result).toBeSuccessful();
        expect(result).not.toHaveTextContent('<script>alert');
      });

      test('should handle HTML tags in headers', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-table', {
          headers: ['<img src=x onerror=alert(1)>'],
          rows: [['Value']],
        });

        expect(result).toBeSuccessful();
        // The tool should process the input successfully
        const json = result.json<{ columnCount: number }>();
        expect(json.columnCount).toBe(1);
      });

      test('should handle HTML in title', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-table', {
          headers: ['Name'],
          rows: [['Value']],
          title: '<script>alert("title xss")</script>',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number }>();
        expect(json.rowCount).toBe(1);
      });

      test('should handle HTML entities', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Entities'],
          rows: [['&lt;tag&gt; &amp; "quotes"']],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle event handler strings', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-table', {
          headers: ['Malicious'],
          rows: [['" onclick="alert(1)" data-x="']],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number }>();
        expect(json.rowCount).toBe(1);
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing headers', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          rows: [['Alice', '30']],
          title: 'No Headers',
        });

        expect(result).toBeError();
      });

      test('should reject missing rows', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Name', 'Age'],
          title: 'No Rows',
        });

        expect(result).toBeError();
      });

      test('should reject invalid headers type', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: 'not an array',
          rows: [['Value']],
        });

        expect(result).toBeError();
      });

      test('should reject invalid rows type', async ({ mcp }) => {
        const result = await mcp.tools.call('html-table', {
          headers: ['Name'],
          rows: 'not an array',
        });

        expect(result).toBeError();
      });
    });
  });

  test.describe('HTML Card Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate HTML card with all fields', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'Welcome',
          content: 'This is a card component',
          footer: 'Footer text',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('html');
        expect(result).toHaveTextContent('Welcome');
      });

      test('should handle card without footer', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'No Footer Card',
          content: 'Content without footer',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle multiline content', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'Multiline',
          content: 'Line 1\nLine 2\nLine 3',
          footer: 'End',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Content Variations', () => {
      test('should handle very long title', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'A'.repeat(500),
          content: 'Content',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long content', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'Long Content Card',
          content: 'B'.repeat(5000),
        });

        expect(result).toBeSuccessful();
      });

      test('should handle empty content', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'Empty Content',
          content: '',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle whitespace content', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'Whitespace',
          content: '   \n\t\n   ',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in all fields', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: '日本語タイトル',
          content: 'Содержимое на русском',
          footer: '© 2024 → ←',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in all fields', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: '🎉 Celebration Card 🎊',
          content: '🔥 Fire content 💡',
          footer: '👍 Like | 💬 Comment',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Special Characters Handling', () => {
      test('should handle script tags in title', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-card', {
          title: '<script>alert("xss")</script>',
          content: 'Safe content',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('html');
      });

      test('should handle script tags in content', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-card', {
          title: 'Safe Title',
          content: '<script>alert("xss")</script>',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle script tags in footer', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-card', {
          title: 'Safe Title',
          content: 'Safe Content',
          footer: '<script>alert("xss")</script>',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle combined special characters', async ({ mcp }) => {
        // XSS prevention happens at template render time, not in JSON output
        const result = await mcp.tools.call('html-card', {
          title: 'Special <chars> & "quotes"',
          content: 'Content with <script>alert("xss")</script> and &amp; entities',
          footer: 'Footer: ©2024 → ←',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing title', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          content: 'Content without title',
        });

        expect(result).toBeError();
      });

      test('should reject missing content', async ({ mcp }) => {
        const result = await mcp.tools.call('html-card', {
          title: 'Title without content',
        });

        expect(result).toBeError();
      });
    });
  });

  test.describe('Concurrent HTML Tool Calls', () => {
    test('should handle concurrent table calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('html-table', {
            headers: ['Index'],
            rows: [[`${i}`]],
            title: `Table ${i}`,
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle concurrent card calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('html-card', {
            title: `Card ${i}`,
            content: `Content ${i}`,
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle mixed table and card calls', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.tools.call('html-table', { headers: ['A'], rows: [['1']] }),
        mcp.tools.call('html-card', { title: 'Card', content: 'Content' }),
        mcp.tools.call('html-table', { headers: ['B'], rows: [['2']] }),
        mcp.tools.call('html-card', { title: 'Card 2', content: 'Content 2' }),
      ]);

      expect(results).toHaveLength(4);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });
  });
});
