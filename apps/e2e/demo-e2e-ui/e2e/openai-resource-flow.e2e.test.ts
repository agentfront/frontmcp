/**
 * E2E Tests for OpenAI Resource Flow
 *
 * Verifies OpenAI MCP Apps compliance — OpenAI now uses the standard ui/* namespace
 * like all other platforms per the MCP Apps specification.
 *
 * Tests cover:
 * 1. tools/list includes ui.resourceUri for static mode tools
 * 2. resources/read returns pre-compiled widget with text/html;profile=mcp-app
 * 3. Static mode tool call returns JSON only (no HTML in _meta)
 * 4. Inline/dynamic mode tool call has HTML in _meta
 * 5. Response structure: structuredContent + content + _meta
 */
import { test, expect } from '@frontmcp/testing';

test.describe('OpenAI Resource Flow E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test.describe('Tools List Metadata', () => {
    test('should include ui.resourceUri for static mode tools', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const tools = await client.tools.list();
      const staticTool = tools.find((t) => t.name === 'static-badge');

      // Per MCP Apps spec: tools/list must include ui.resourceUri pointing to resource
      expect(staticTool).toBeDefined();
      const uiMeta = staticTool?._meta?.['ui'] as Record<string, unknown> | undefined;
      expect(uiMeta).toBeDefined();
      expect(uiMeta?.resourceUri).toMatch(/^ui:\/\/widget\/.*\.html$/);

      await client.disconnect();
    });

    test('should include ui.resourceUri for inline mode tools', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const tools = await client.tools.list();
      const inlineTool = tools.find((t) => t.name === 'html-card');

      expect(inlineTool).toBeDefined();
      const uiMeta = inlineTool?._meta?.['ui'] as Record<string, unknown> | undefined;
      expect(uiMeta).toBeDefined();
      expect(uiMeta?.resourceUri).toMatch(/^ui:\/\/widget\/.*\.html$/);

      await client.disconnect();
    });

    test('should include ui metadata when widgetAccessible is configured', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const tools = await client.tools.list();

      // Find any tool with widgetAccessible: true configured
      const hybridTool = tools.find((t) => t.name === 'hybrid-status');
      expect(hybridTool).toBeDefined();
      const uiMeta = hybridTool?._meta?.['ui'] as Record<string, unknown> | undefined;
      expect(uiMeta).toBeDefined();
      expect(uiMeta?.resourceUri).toBeDefined();
      expect(typeof uiMeta?.resourceUri).toBe('string');

      await client.disconnect();
    });
  });

  test.describe('Resource Reading (Static Widget)', () => {
    test('should return pre-compiled widget from resources/read', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      // Read the static widget resource
      const resource = await client.resources.read('ui://widget/static-badge.html');

      expect(resource).toBeSuccessful();
      expect(resource.text()).toBeDefined();

      await client.disconnect();
    });

    test('should have text/html;profile=mcp-app MIME type', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const resource = await client.resources.read('ui://widget/static-badge.html');

      expect(resource).toBeSuccessful();
      expect(resource.hasMimeType('text/html;profile=mcp-app')).toBe(true);

      await client.disconnect();
    });

    test('should contain valid HTML document', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const resource = await client.resources.read('ui://widget/static-badge.html');
      const html = resource.text();

      expect(resource).toBeSuccessful();
      expect(html).toBeDefined();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');

      await client.disconnect();
    });

    test('should include FrontMCP Bridge for data access', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const resource = await client.resources.read('ui://widget/static-badge.html');
      const html = resource.text();

      expect(resource).toBeSuccessful();
      // Bridge provides window.openai compatibility for OpenAI platform
      // Or uses frontmcp bridge abstraction
      expect(html).toMatch(/window\.(openai|frontmcp|__mcp)/);

      await client.disconnect();
    });
  });

  test.describe('Static Mode Tool Response', () => {
    test('should return JSON only, no HTML in _meta', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('static-badge', {
        label: 'Test',
        value: 'Value',
        color: 'green',
      });

      expect(result).toBeSuccessful();
      // Static mode: no HTML in response (widget fetched via resource)
      expect(result.hasToolUI()).toBe(false);
      expect(result).toNotHaveMetaKey('ui/html');

      await client.disconnect();
    });

    test('should return correct JSON data', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('static-badge', {
        label: 'Build',
        value: 'Passing',
        color: 'green',
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ label: string; value: string; color: string }>();
      expect(json.label).toBe('Build');
      expect(json.value).toBe('Passing');
      expect(json.color).toBe('green');

      await client.disconnect();
    });

    test('should have structuredContent with raw output', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('static-badge', {
        label: 'Status',
        value: 'Active',
        color: 'blue',
      });

      expect(result).toBeSuccessful();
      // structuredContent should contain the raw tool output
      expect(result.raw.structuredContent).toBeDefined();

      await client.disconnect();
    });
  });

  test.describe('Inline/Dynamic Mode Tool Response', () => {
    test('should have HTML in _meta for inline mode tools', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Dynamic Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);
      expect(result).toHaveMetaKey('ui/html');

      await client.disconnect();
    });

    test('should have correct MIME type text/html;profile=mcp-app', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'MIME Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('should include valid HTML in ui/html', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'HTML Validation',
        content: 'Test content',
      });

      expect(result).toBeSuccessful();
      const html = result.raw._meta?.['ui/html'] as string;
      expect(html).toBeDefined();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('HTML Validation'); // Title should be in HTML

      await client.disconnect();
    });

    test('should have structuredContent with raw output', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Structured Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();
      expect(result.raw.structuredContent).toBeDefined();

      await client.disconnect();
    });
  });

  test.describe('Hybrid Mode Tool Response', () => {
    test('should have HTML in _meta for hybrid mode tools', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('hybrid-status', {
        serviceName: 'API Server',
        status: 'healthy',
        uptime: 99.95,
      });

      expect(result).toBeSuccessful();
      expect(result.hasToolUI()).toBe(true);

      await client.disconnect();
    });

    test('should return correct JSON data', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('hybrid-status', {
        serviceName: 'Database',
        status: 'degraded',
        uptime: 98.5,
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ serviceName: string; status: string; isHealthy: boolean }>();
      expect(json.serviceName).toBe('Database');
      expect(json.status).toBe('degraded');
      expect(json.isHealthy).toBe(false);

      await client.disconnect();
    });
  });

  test.describe('OpenAI Namespace — Uses Standard ui/* Keys', () => {
    test('should only use ui/* keys, not openai/* or frontmcp/*', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Namespace Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();

      // Verify ui/* keys present
      expect(result).toHaveMetaKey('ui/html');

      // Verify NO openai/* keys (unified to ui/*)
      expect(result).toNotHaveMetaKey('openai/html');
      expect(result).toNotHaveMetaKey('openai/mimeType');

      // Verify NO frontmcp/* keys
      expect(result).toNotHaveMetaKey('frontmcp/html');
      expect(result).toNotHaveMetaKey('frontmcp/mimeType');

      await client.disconnect();
    });
  });

  test.describe('Response Structure Compliance', () => {
    test('should have content array with text narration', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Response Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();
      expect(result.raw.content).toBeDefined();
      expect(Array.isArray(result.raw.content)).toBe(true);

      await client.disconnect();
    });

    test('should have _meta with widget data', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Meta Test',
        content: 'Content',
      });

      expect(result).toBeSuccessful();
      expect(result.raw._meta).toBeDefined();
      expect(typeof result.raw._meta).toBe('object');

      await client.disconnect();
    });
  });
});
