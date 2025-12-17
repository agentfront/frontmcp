/**
 * UI Tools E2E Integration Tests
 *
 * This is the main integration test file that provides quick smoke tests
 * for all UI tool types. For detailed tests, see:
 * - html-tools.e2e.test.ts
 * - react-tools.e2e.test.ts
 * - mdx-tools.e2e.test.ts
 * - markdown-tools.e2e.test.ts
 * - platform-detection.e2e.test.ts
 * - discovery-and-metadata.e2e.test.ts
 */
import { test, expect } from '@frontmcp/testing';

test.describe('UI Tools E2E Integration', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('Smoke Tests - All Tool Types', () => {
    test('should generate HTML table', async ({ mcp }) => {
      const result = await mcp.tools.call('html-table', {
        headers: ['Name', 'Age'],
        rows: [['Alice', '30']],
        title: 'Users',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ rowCount: number }>();
      expect(json.rowCount).toBe(1);
    });

    test('should generate HTML card', async ({ mcp }) => {
      const result = await mcp.tools.call('html-card', {
        title: 'Welcome',
        content: 'Hello World',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ title: string }>();
      expect(json.title).toBe('Welcome');
    });

    test('should generate React chart', async ({ mcp }) => {
      const result = await mcp.tools.call('react-chart', {
        data: [{ label: 'Jan', value: 100 }],
        title: 'Sales',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ maxValue: number }>();
      expect(json.maxValue).toBe(100);
    });

    test('should generate React form', async ({ mcp }) => {
      const result = await mcp.tools.call('react-form', {
        fields: [{ name: 'email', type: 'email', label: 'Email' }],
        submitLabel: 'Submit',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ fieldCount: number }>();
      expect(json.fieldCount).toBe(1);
    });

    test('should generate MDX document', async ({ mcp }) => {
      const result = await mcp.tools.call('mdx-doc', {
        title: 'Documentation',
        sections: [{ heading: 'Intro', content: 'Welcome' }],
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ sectionCount: number }>();
      expect(json.sectionCount).toBe(1);
    });

    test('should generate interactive MDX', async ({ mcp }) => {
      const result = await mcp.tools.call('mdx-interactive', {
        topic: 'Tips',
        points: ['Tip 1', 'Tip 2'],
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ topic: string }>();
      expect(json.topic).toBe('Tips');
    });

    test('should generate markdown report', async ({ mcp }) => {
      const result = await mcp.tools.call('markdown-report', {
        title: 'Report',
        summary: 'Summary',
        findings: [{ title: 'Issue', description: 'Desc', severity: 'low' }],
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ findingCount: number }>();
      expect(json.findingCount).toBe(1);
    });

    test('should generate markdown list', async ({ mcp }) => {
      const result = await mcp.tools.call('markdown-list', {
        title: 'Tasks',
        items: [{ text: 'Task 1', completed: true }],
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ completedCount: number }>();
      expect(json.completedCount).toBe(1);
    });
  });

  test.describe('Quick Discovery Tests', () => {
    test('should list all 8 UI tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('html-table');
      expect(tools).toContainTool('html-card');
      expect(tools).toContainTool('react-chart');
      expect(tools).toContainTool('react-form');
      expect(tools).toContainTool('mdx-doc');
      expect(tools).toContainTool('mdx-interactive');
      expect(tools).toContainTool('markdown-report');
      expect(tools).toContainTool('markdown-list');
    });

    test('should list resources', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('widgets://templates');
    });

    test('should list prompts', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('ui-showcase');
    });
  });

  test.describe('Quick Error Handling Tests', () => {
    test('should reject invalid tool call', async ({ mcp }) => {
      const result = await mcp.tools.call('html-table', {
        // Missing required headers
        rows: [['1']],
      });
      expect(result).toBeError();
    });

    test('should reject non-existent prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('non-existent', {});
      expect(result).toBeError();
    });
  });

  test.describe('Quick Platform Tests', () => {
    test('should return UI for OpenAI client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should handle Claude client', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();

      await client.disconnect();
    });
  });

  test.describe('Concurrent Operations', () => {
    test('should handle concurrent tool calls', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.tools.call('html-table', { headers: ['A'], rows: [['1']] }),
        mcp.tools.call('html-card', { title: 'Card', content: 'Content' }),
        mcp.tools.call('react-chart', { data: [{ label: 'X', value: 10 }] }),
        mcp.tools.call('markdown-list', { title: 'List', items: [{ text: 'Item', completed: true }] }),
      ]);

      expect(results).toHaveLength(4);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });
  });
});
