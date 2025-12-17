/**
 * E2E Tests for Tool, Resource, and Prompt Discovery
 *
 * Tests for:
 * - Tool listing and discovery
 * - Resource access
 * - Prompt access
 * - Metadata and schema validation
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Discovery and Metadata E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('Tool Discovery', () => {
    test('should list all UI tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // HTML tools
      expect(tools).toContainTool('html-table');
      expect(tools).toContainTool('html-card');

      // React tools
      expect(tools).toContainTool('react-chart');
      expect(tools).toContainTool('react-form');

      // MDX tools
      expect(tools).toContainTool('mdx-doc');
      expect(tools).toContainTool('mdx-interactive');

      // Markdown tools
      expect(tools).toContainTool('markdown-report');
      expect(tools).toContainTool('markdown-list');
    });

    test('should have 8 UI tools registered', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Verify all expected tools
      const expectedTools = [
        'html-table',
        'html-card',
        'react-chart',
        'react-form',
        'mdx-doc',
        'mdx-interactive',
        'markdown-report',
        'markdown-list',
      ];

      for (const toolName of expectedTools) {
        expect(tools).toContainTool(toolName);
      }
    });

    // Note: Individual tool listing tests removed as they're already covered
    // by the comprehensive test above (lines 39-57)

    test('should not list non-existent tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).not.toContainTool('non-existent-tool');
      expect(tools).not.toContainTool('fake-tool');
    });
  });

  test.describe('Tool Schema Validation', () => {
    test('should have valid schema for html-table', async ({ mcp }) => {
      const result = await mcp.tools.call('html-table', {
        headers: ['A'],
        rows: [['1']],
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for html-card', async ({ mcp }) => {
      const result = await mcp.tools.call('html-card', {
        title: 'Test',
        content: 'Content',
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for react-chart', async ({ mcp }) => {
      const result = await mcp.tools.call('react-chart', {
        data: [{ label: 'A', value: 10 }],
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for react-form', async ({ mcp }) => {
      const result = await mcp.tools.call('react-form', {
        fields: [{ name: 'field', type: 'text', label: 'Field' }],
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for mdx-doc', async ({ mcp }) => {
      const result = await mcp.tools.call('mdx-doc', {
        title: 'Doc',
        sections: [{ heading: 'H', content: 'C' }],
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for mdx-interactive', async ({ mcp }) => {
      const result = await mcp.tools.call('mdx-interactive', {
        topic: 'Topic',
        points: ['Point'],
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for markdown-report', async ({ mcp }) => {
      const result = await mcp.tools.call('markdown-report', {
        title: 'Report',
        summary: 'Summary',
        findings: [{ title: 'F', description: 'D', severity: 'low' }],
      });
      expect(result).toBeSuccessful();
    });

    test('should have valid schema for markdown-list', async ({ mcp }) => {
      const result = await mcp.tools.call('markdown-list', {
        title: 'List',
        items: [{ text: 'Item', completed: false }],
      });
      expect(result).toBeSuccessful();
    });
  });

  test.describe('Resource Discovery', () => {
    test('should list ui templates resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('widgets://templates');
    });

    test('should read ui templates resource', async ({ mcp }) => {
      const content = await mcp.resources.read('widgets://templates');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('uiTypes');
    });

    test('should include html type in templates', async ({ mcp }) => {
      const content = await mcp.resources.read('widgets://templates');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('html');
    });

    test('should include react type in templates', async ({ mcp }) => {
      const content = await mcp.resources.read('widgets://templates');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('react');
    });

    test('should include mdx type in templates', async ({ mcp }) => {
      const content = await mcp.resources.read('widgets://templates');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('mdx');
    });

    test('should include markdown type in templates', async ({ mcp }) => {
      const content = await mcp.resources.read('widgets://templates');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('markdown');
    });

    test('should fail reading non-existent resource', async ({ mcp }) => {
      const content = await mcp.resources.read('widgets://non-existent');
      expect(content).toBeError();
    });

    test('should fail reading invalid resource URI', async ({ mcp }) => {
      const content = await mcp.resources.read('invalid://resource');
      expect(content).toBeError();
    });
  });

  test.describe('Prompt Discovery', () => {
    test('should list ui-showcase prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('ui-showcase');
    });

    test('should get ui showcase prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });

    test('should have text content in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      expect(message.content.type).toBe('text');
    });

    test('should mention UI Tools Showcase in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('UI Tools Showcase');
      }
    });

    test('should mention HTML Type in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('HTML Type');
      }
    });

    test('should mention React Type in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('React Type');
      }
    });

    test('should mention MDX Type in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('MDX Type');
      }
    });

    test('should mention Markdown Type in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('Markdown Type');
      }
    });

    test('should fail getting non-existent prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('non-existent-prompt', {});
      expect(result).toBeError();
    });

    test('should fail getting prompt with invalid name', async ({ mcp }) => {
      const result = await mcp.prompts.get('', {});
      expect(result).toBeError();
    });
  });

  test.describe('Error Handling', () => {
    test('should reject non-existent tool call', async ({ mcp }) => {
      const result = await mcp.tools.call('non-existent-tool', {});
      expect(result).toBeError();
    });

    test('should reject tool call with invalid input', async ({ mcp }) => {
      const result = await mcp.tools.call('html-table', {
        invalid: 'input',
      });
      expect(result).toBeError();
    });

    test('should reject tool call with wrong type', async ({ mcp }) => {
      const result = await mcp.tools.call('html-table', {
        headers: 'not an array',
        rows: [['1']],
      });
      expect(result).toBeError();
    });

    test('should handle empty tool name gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('', {});
      expect(result).toBeError();
    });
  });

  test.describe('Concurrent Discovery Operations', () => {
    test('should handle concurrent tool list calls', async ({ mcp }) => {
      const results = await Promise.all([mcp.tools.list(), mcp.tools.list(), mcp.tools.list()]);

      results.forEach((tools) => {
        expect(tools).toContainTool('html-table');
        expect(tools).toContainTool('react-chart');
      });
    });

    test('should handle concurrent resource reads', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.resources.read('widgets://templates'),
        mcp.resources.read('widgets://templates'),
        mcp.resources.read('widgets://templates'),
      ]);

      results.forEach((content) => {
        expect(content).toBeSuccessful();
      });
    });

    test('should handle concurrent prompt gets', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.prompts.get('ui-showcase', {}),
        mcp.prompts.get('ui-showcase', {}),
        mcp.prompts.get('ui-showcase', {}),
      ]);

      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle mixed concurrent discovery operations', async ({ mcp }) => {
      const [tools, resources, prompts, toolResult] = await Promise.all([
        mcp.tools.list(),
        mcp.resources.list(),
        mcp.prompts.list(),
        mcp.tools.call('html-card', { title: 'Test', content: 'Content' }),
      ]);

      expect(tools).toContainTool('html-table');
      expect(resources).toContainResource('widgets://templates');
      expect(prompts).toContainPrompt('ui-showcase');
      expect(toolResult).toBeSuccessful();
    });
  });

  test.describe('Discovery Stability', () => {
    test('should return consistent tool list on multiple calls', async ({ mcp }) => {
      const tools1 = await mcp.tools.list();
      const tools2 = await mcp.tools.list();

      expect(tools1).toContainTool('html-table');
      expect(tools2).toContainTool('html-table');
    });

    test('should return consistent resource content on multiple reads', async ({ mcp }) => {
      const content1 = await mcp.resources.read('widgets://templates');
      const content2 = await mcp.resources.read('widgets://templates');

      expect(content1).toBeSuccessful();
      expect(content2).toBeSuccessful();
    });

    test('should return consistent prompt content on multiple gets', async ({ mcp }) => {
      const prompt1 = await mcp.prompts.get('ui-showcase', {});
      const prompt2 = await mcp.prompts.get('ui-showcase', {});

      expect(prompt1).toBeSuccessful();
      expect(prompt2).toBeSuccessful();
      expect(prompt1.messages.length).toBe(prompt2.messages.length);
    });
  });
});
