/**
 * E2E Tests for Shell Builder via MCP
 *
 * Tests buildShell() wrapper tool including:
 * - Full HTML shell generation with CSP, data injection, bridge
 * - Shell-less mode
 * - Custom CSP domains
 * - Data injection globals
 * - Bridge inclusion/exclusion
 * - Custom title
 * - Hash and size output
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Shell Builder E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-uipack/src/main.ts',
    project: 'demo-e2e-uipack',
    publicMode: true,
  });

  test.describe('Tool Discovery', () => {
    test('should list build-shell tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('build-shell');
    });
  });

  test.describe('Full HTML Shell', () => {
    test('should build full HTML shell with DOCTYPE', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div id="app">Hello World</div>',
        toolName: 'test-tool',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string; hash: string; size: number }>();
      expect(json.html).toContain('<!DOCTYPE html>');
      expect(json.html).toContain('<html');
      expect(json.html).toContain('Hello World');
      expect(json.html).toContain('Content-Security-Policy');
    });

    test('should include data injection script', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div id="app"></div>',
        toolName: 'my-tool',
        input: { query: 'hello' },
        output: { answer: 42 },
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string }>();
      expect(json.html).toContain('__mcpToolName');
      expect(json.html).toContain('my-tool');
      expect(json.html).toContain('__mcpToolInput');
      expect(json.html).toContain('__mcpToolOutput');
    });

    test('should include bridge runtime by default', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div></div>',
        toolName: 'test',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string }>();
      expect(json.html).toContain('FrontMcpBridge');
    });

    test('should exclude bridge when includeBridge is false', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div></div>',
        toolName: 'test',
        includeBridge: false,
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string }>();
      expect(json.html).not.toContain('FrontMcpBridge');
    });

    test('should set custom title', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div></div>',
        toolName: 'test',
        title: 'My Widget',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string }>();
      expect(json.html).toContain('<title>My Widget</title>');
    });

    test('should return non-empty hash and positive size', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div>content</div>',
        toolName: 'test',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string; hash: string; size: number }>();
      expect(json.hash).toBeTruthy();
      expect(json.hash.length).toBeGreaterThan(0);
      expect(json.size).toBeGreaterThan(0);
    });
  });

  test.describe('Shell-less Mode', () => {
    test('should return content without HTML wrapper when withShell is false', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div id="app">Inline</div>',
        toolName: 'test',
        withShell: false,
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string }>();
      expect(json.html).not.toContain('<!DOCTYPE html>');
      expect(json.html).not.toContain('<html');
      expect(json.html).toContain('Inline');
      expect(json.html).toContain('__mcpToolName');
    });
  });

  test.describe('CSP Configuration', () => {
    test('should include custom resource domains in CSP', async ({ mcp }) => {
      const result = await mcp.tools.call('build-shell', {
        content: '<div></div>',
        toolName: 'test',
        cspResourceDomains: ['https://cdn.example.com', 'https://assets.test.org'],
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ html: string }>();
      expect(json.html).toContain('cdn.example.com');
      expect(json.html).toContain('assets.test.org');
    });
  });
});
