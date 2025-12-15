/**
 * E2E Tests for UI Tools
 *
 * Tests UI tool rendering across 4 types:
 * - HTML: html-table, html-card
 * - React: react-chart, react-form
 * - MDX: mdx-doc, mdx-interactive
 * - Markdown: markdown-report, markdown-list
 */
import { test, expect } from '@frontmcp/testing';

test.describe('UI Tools E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('HTML UI Tools', () => {
    test('should generate HTML table', async ({ mcp }) => {
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

    test('should generate HTML card', async ({ mcp }) => {
      const result = await mcp.tools.call('html-card', {
        title: 'Welcome',
        content: 'This is a card component',
        footer: 'Footer text',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('html');
      expect(result).toHaveTextContent('Welcome');
    });
  });

  test.describe('React UI Tools', () => {
    test('should generate React chart', async ({ mcp }) => {
      const result = await mcp.tools.call('react-chart', {
        data: [
          { label: 'Jan', value: 100 },
          { label: 'Feb', value: 150 },
          { label: 'Mar', value: 120 },
        ],
        title: 'Monthly Sales',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('react');
      expect(result).toHaveTextContent('maxValue');
    });

    test('should generate React form', async ({ mcp }) => {
      const result = await mcp.tools.call('react-form', {
        fields: [
          { name: 'email', type: 'email', label: 'Email', required: true },
          { name: 'message', type: 'textarea', label: 'Message' },
        ],
        submitLabel: 'Send',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('react');
      expect(result).toHaveTextContent('fieldCount');
    });
  });

  test.describe('MDX UI Tools', () => {
    test('should generate MDX document', async ({ mcp }) => {
      const result = await mcp.tools.call('mdx-doc', {
        title: 'API Documentation',
        sections: [
          { heading: 'Getting Started', content: 'Install the package...' },
          { heading: 'Authentication', content: 'Use an API key...' },
        ],
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('mdx');
      expect(result).toHaveTextContent('sectionCount');
    });

    test('should generate interactive MDX', async ({ mcp }) => {
      const result = await mcp.tools.call('mdx-interactive', {
        topic: 'TypeScript Tips',
        points: ['Use strict mode', 'Prefer interfaces', 'Avoid any'],
        codeExample: 'const x: string = "hello";',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('mdx');
      expect(result).toHaveTextContent('hasCode');
    });
  });

  test.describe('Markdown UI Tools', () => {
    test('should generate markdown report', async ({ mcp }) => {
      const result = await mcp.tools.call('markdown-report', {
        title: 'Security Audit',
        summary: 'Overall security posture is good',
        findings: [
          { title: 'Missing HTTPS', description: 'Enable HTTPS', severity: 'high' },
          { title: 'Weak Password', description: 'Improve policy', severity: 'medium' },
        ],
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('markdown');
      expect(result).toHaveTextContent('findingCount');
    });

    test('should generate markdown list', async ({ mcp }) => {
      const result = await mcp.tools.call('markdown-list', {
        title: 'Todo List',
        items: [
          { text: 'Review PR', completed: true },
          { text: 'Write tests', completed: false },
          { text: 'Deploy', completed: false },
        ],
        ordered: true,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('markdown');
      expect(result).toHaveTextContent('completedCount');
    });
  });

  test.describe('Resource Access', () => {
    test('should list ui templates resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('ui://templates');
    });

    test('should read ui templates', async ({ mcp }) => {
      const content = await mcp.resources.read('ui://templates');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('uiTypes');
      expect(content).toHaveTextContent('html');
      expect(content).toHaveTextContent('react');
      expect(content).toHaveTextContent('mdx');
      expect(content).toHaveTextContent('markdown');
    });
  });

  test.describe('Prompt Access', () => {
    test('should list ui-showcase prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('ui-showcase');
    });

    test('should get ui showcase prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('ui-showcase', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('UI Tools Showcase');
        expect(message.content.text).toContain('HTML Type');
        expect(message.content.text).toContain('React Type');
        expect(message.content.text).toContain('MDX Type');
        expect(message.content.text).toContain('Markdown Type');
      }
    });
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
  });
});
