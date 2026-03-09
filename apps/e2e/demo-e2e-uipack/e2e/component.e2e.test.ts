/**
 * E2E Tests for Component Loader via MCP
 *
 * Tests resolveUISource() wrapper tool including:
 * - NPM source resolution
 * - Import URL source
 * - Function source (inline)
 * - Custom export name
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Component Loader E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-uipack/src/main.ts',
    project: 'demo-e2e-uipack',
    publicMode: true,
  });

  test.describe('Tool Discovery', () => {
    test('should list load-component tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('load-component');
    });
  });

  test.describe('NPM Source', () => {
    test('should resolve npm source with module mode and CDN URL', async ({ mcp }) => {
      const result = await mcp.tools.call('load-component', {
        sourceType: 'npm',
        packageName: '@my-org/widget',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{
        mode: string;
        url: string;
        exportName: string;
        peerDependencies: string[];
      }>();
      expect(json.mode).toBe('module');
      expect(json.url).toContain('esm.sh');
      expect(json.exportName).toBe('default');
      expect(json.peerDependencies).toContain('react');
      expect(json.peerDependencies).toContain('react-dom');
    });

    test('should respect custom export name', async ({ mcp }) => {
      const result = await mcp.tools.call('load-component', {
        sourceType: 'npm',
        packageName: 'my-lib',
        exportName: 'MyComponent',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ exportName: string }>();
      expect(json.exportName).toBe('MyComponent');
    });
  });

  test.describe('Import Source', () => {
    test('should pass URL through directly', async ({ mcp }) => {
      const result = await mcp.tools.call('load-component', {
        sourceType: 'import',
        importUrl: 'https://cdn.example.com/widget.js',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ mode: string; url: string; peerDependencies: string[] }>();
      expect(json.mode).toBe('module');
      expect(json.url).toBe('https://cdn.example.com/widget.js');
      expect(json.peerDependencies).toEqual([]);
    });
  });

  test.describe('Function Source', () => {
    test('should return inline mode with HTML', async ({ mcp }) => {
      const result = await mcp.tools.call('load-component', {
        sourceType: 'function',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ mode: string; html: string }>();
      expect(json.mode).toBe('inline');
      expect(json.html).toContain('Function component rendered');
    });
  });

  test.describe('Error Handling', () => {
    test('should error when npm source has no packageName', async ({ mcp }) => {
      const result = await mcp.tools.call('load-component', {
        sourceType: 'npm',
      });

      expect(result).toBeError();
      expect(result).toHaveTextContent('packageName');
    });

    test('should error when import source has no importUrl', async ({ mcp }) => {
      const result = await mcp.tools.call('load-component', {
        sourceType: 'import',
      });

      expect(result).toBeError();
      expect(result).toHaveTextContent('importUrl');
    });
  });
});
