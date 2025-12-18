/**
 * E2E Tests for Multi-Client Platform Detection
 *
 * Tests UI tool output across different platform clients:
 * - OpenAI: structuredContent format (HTML in content, raw data in structuredContent)
 * - Claude: structuredContent format (HTML in content, raw data in structuredContent)
 * - Cursor: structuredContent format (HTML in content, raw data in structuredContent)
 * - Continue: structuredContent format (HTML in content, raw data in structuredContent)
 * - Cody: structuredContent format (HTML in content, raw data in structuredContent)
 * - Gemini/Unknown: JSON only (no UI rendering, no widget support)
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Platform Detection E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('OpenAI Platform', () => {
    test('should return UI HTML for ChatGPT client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'OpenAI Test',
        content: 'Testing OpenAI platform detection',
        footer: 'Test footer',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should return UI HTML for OpenAI client variant', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'OpenAI', version: '2.0.0' },
      });

      const result = await client.tools.call('react-chart', {
        data: [{ label: 'A', value: 10 }],
        title: 'OpenAI Chart',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle multiple tool calls from OpenAI client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const results = await Promise.all([
        client.tools.call('html-table', { headers: ['A'], rows: [['1']] }),
        client.tools.call('html-card', { title: 'Card', content: 'Content' }),
        client.tools.call('react-chart', { data: [{ label: 'X', value: 10 }] }),
      ]);

      results.forEach((result) => {
        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(true);
      });

      await client.disconnect();
    });
  });

  test.describe('Claude Platform', () => {
    test('should return structuredContent format for Claude Desktop client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Claude Test',
        content: 'Testing Claude platform detection',
        footer: 'Test footer',
      });

      expect(result).toBeSuccessful();
      // Claude now uses structuredContent format like OpenAI:
      // - content: single block with raw HTML
      // - structuredContent: raw tool output
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should return structuredContent format for Claude client variant', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Claude', version: '2.0.0' },
      });

      const result = await client.tools.call('markdown-report', {
        title: 'Claude Report',
        summary: 'Summary',
        findings: [{ title: 'Finding', description: 'Desc', severity: 'low' }],
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle multiple tool calls from Claude client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      });

      const results = await Promise.all([
        client.tools.call('mdx-doc', {
          title: 'Doc',
          sections: [{ heading: 'H', content: 'C' }],
        }),
        client.tools.call('markdown-list', {
          title: 'List',
          items: [{ text: 'Item', completed: true }],
        }),
      ]);

      results.forEach((result) => {
        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(true);
      });

      await client.disconnect();
    });
  });

  test.describe('Cursor Platform', () => {
    test('should return UI HTML for Cursor client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Cursor', version: '1.0.0' },
      });

      const result = await client.tools.call('react-chart', {
        data: [
          { label: 'A', value: 10 },
          { label: 'B', value: 20 },
        ],
        title: 'Cursor Chart Test',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle form tool from Cursor client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Cursor', version: '2.0.0' },
      });

      const result = await client.tools.call('react-form', {
        fields: [{ name: 'field', type: 'text', label: 'Field' }],
        submitLabel: 'Submit',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle multiple tool calls from Cursor client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Cursor', version: '1.0.0' },
      });

      const results = await Promise.all([
        client.tools.call('html-table', { headers: ['A'], rows: [['1']] }),
        client.tools.call('react-form', {
          fields: [{ name: 'f', type: 'text', label: 'F' }],
        }),
      ]);

      results.forEach((result) => {
        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(true);
      });

      await client.disconnect();
    });
  });

  test.describe('Continue Platform', () => {
    test('should return UI HTML for Continue client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Continue', version: '2.0.0' },
      });

      const result = await client.tools.call('react-form', {
        fields: [{ name: 'test', type: 'text', label: 'Test Field' }],
        submitLabel: 'Go',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle MDX tools from Continue client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Continue', version: '1.5.0' },
      });

      const result = await client.tools.call('mdx-interactive', {
        topic: 'Continue Topic',
        points: ['Point 1', 'Point 2'],
        codeExample: 'const x = 1;',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });
  });

  test.describe('Cody Platform', () => {
    test('should return UI HTML for Sourcegraph Cody client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Sourcegraph Cody', version: '1.0.0' },
      });

      const result = await client.tools.call('markdown-list', {
        title: 'Cody Test',
        items: [{ text: 'Item 1', completed: false }],
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle report tool from Cody client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Cody', version: '2.0.0' },
      });

      const result = await client.tools.call('markdown-report', {
        title: 'Cody Report',
        summary: 'Summary',
        findings: [{ title: 'F', description: 'D', severity: 'medium' }],
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });
  });

  test.describe('Gemini Platform', () => {
    test('should return JSON-only for Gemini client (no UI support)', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Gemini', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Gemini Test',
        content: 'Testing Gemini platform detection',
      });

      expect(result).toBeSuccessful();
      // Gemini doesn't support widgets, UI should be skipped
      expect(result.hasToolUI()).toBe(false);

      await client.disconnect();
    });

    test('should handle tool calls from Google AI client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Google AI', version: '2.0.0' },
      });

      const result = await client.tools.call('react-chart', {
        data: [{ label: 'A', value: 10 }],
        title: 'Google AI Chart',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ maxValue: number }>();
      expect(json.maxValue).toBe(10);

      await client.disconnect();
    });
  });

  test.describe('Unknown Platform', () => {
    test('should return JSON-only for unknown client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Unknown Client', version: '1.0.0' },
      });

      const result = await client.tools.call('html-table', {
        headers: ['Col1', 'Col2'],
        rows: [['A', 'B']],
        title: 'Unknown Client Test',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ rowCount: number }>();
      expect(json.rowCount).toBe(1);

      await client.disconnect();
    });

    test('should return JSON-only for random client name', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'RandomApp_12345', version: '0.0.1' },
      });

      const result = await client.tools.call('react-chart', {
        data: [{ label: 'X', value: 100 }],
        title: 'Random Client Chart',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ maxValue: number }>();
      expect(json.maxValue).toBe(100);

      await client.disconnect();
    });

    test('should return JSON-only for client with special characters', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Test Client <Special> & "Chars"', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();

      await client.disconnect();
    });

    test('should handle multiple tool calls from unknown client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'MyCustomClient', version: '1.0.0' },
      });

      const results = await Promise.all([
        client.tools.call('html-table', { headers: ['A'], rows: [['1']] }),
        client.tools.call('markdown-report', {
          title: 'R',
          summary: 'S',
          findings: [{ title: 'F', description: 'D', severity: 'low' }],
        }),
      ]);

      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });

      await client.disconnect();
    });
  });

  test.describe('Cross-Platform Consistency', () => {
    test('should return same data structure across platforms', async ({ server }) => {
      const platforms = [
        { name: 'ChatGPT', version: '1.0.0' },
        { name: 'Claude Desktop', version: '1.0.0' },
        { name: 'Cursor', version: '1.0.0' },
        { name: 'Unknown', version: '1.0.0' },
      ];

      for (const platform of platforms) {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: platform,
        });

        const result = await client.tools.call('html-table', {
          headers: ['Name', 'Value'],
          rows: [['Test', '123']],
          title: `${platform.name} Test`,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ rowCount: number; columnCount: number }>();
        expect(json.rowCount).toBe(1);
        expect(json.columnCount).toBe(2);

        await client.disconnect();
      }
    });

    test('should maintain data integrity across concurrent cross-platform calls', async ({ server }) => {
      const clients = await Promise.all([
        server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'ChatGPT', version: '1.0.0' },
        }),
        server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
        }),
        server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Cursor', version: '1.0.0' },
        }),
      ]);

      const results = await Promise.all(
        clients.map((client, i) =>
          client.tools.call('react-chart', {
            data: [{ label: `P${i}`, value: (i + 1) * 100 }],
            title: `Chart ${i}`,
          }),
        ),
      );

      results.forEach((result, i) => {
        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe((i + 1) * 100);
      });

      await Promise.all(clients.map((client) => client.disconnect()));
    });
  });

  test.describe('Version Handling', () => {
    test('should handle different ChatGPT versions', async ({ server }) => {
      const versions = ['1.0.0', '2.0.0', '3.5.0', '4.0.0'];

      for (const version of versions) {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'ChatGPT', version },
        });

        const result = await client.tools.call('html-card', {
          title: `Version ${version}`,
          content: 'Test',
        });

        expect(result).toBeSuccessful();

        await client.disconnect();
      }
    });

    test('should handle pre-release versions', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Cursor', version: '1.0.0-beta.1' },
      });

      const result = await client.tools.call('html-table', {
        headers: ['A'],
        rows: [['1']],
      });

      expect(result).toBeSuccessful();

      await client.disconnect();
    });
  });

  test.describe('Session Isolation', () => {
    test('should maintain separate sessions for different clients', async ({ server }) => {
      const client1 = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const client2 = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      });

      // Call from client1
      const result1 = await client1.tools.call('html-table', {
        headers: ['Client'],
        rows: [['Client1']],
        title: 'Client 1 Table',
      });

      // Call from client2
      const result2 = await client2.tools.call('html-table', {
        headers: ['Client'],
        rows: [['Client2']],
        title: 'Client 2 Table',
      });

      expect(result1).toBeSuccessful();
      expect(result2).toBeSuccessful();

      // Both should have correct platform behavior (structuredContent format)
      expect(result1.hasToolUI()).toBe(true);
      expect(result2.hasToolUI()).toBe(true);

      await client1.disconnect();
      await client2.disconnect();
    });

    test('should handle rapid client creation and disconnection', async ({ server }) => {
      for (let i = 0; i < 5; i++) {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: `RapidClient${i}`, version: '1.0.0' },
        });

        const result = await client.tools.call('html-card', {
          title: `Rapid ${i}`,
          content: 'Content',
        });

        expect(result).toBeSuccessful();

        await client.disconnect();
      }
    });
  });
});
