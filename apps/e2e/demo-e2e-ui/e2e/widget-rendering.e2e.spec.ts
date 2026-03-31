/**
 * E2E Tests for Widget Rendering Pipeline
 *
 * Verifies that React components using FileSource (`template: { file: '...' }`)
 * are properly bundled with esbuild and served as inline HTML with esm.sh import maps.
 *
 * Tests cover:
 * 1. Widget resource returns HTML with bundled React component
 * 2. Import map uses esm.sh CDN URLs (no local filesystem paths)
 * 3. Tool call returns structuredContent with correct data
 * 4. HTML includes MCP Apps bridge and data injection globals
 * 5. No server filesystem paths leak into client HTML
 * 6. Component code (Card, Badge) is present in bundled output
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Widget Rendering Pipeline E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test.describe('FileSource React Widget — Resource Read', () => {
    test('should return bundled HTML from resources/read', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');

      expect(resource).toBeSuccessful();
      expect(resource.hasMimeType('text/html;profile=mcp-app')).toBe(true);

      const html = resource.text();
      expect(html).toBeDefined();
      expect(html).toContain('<!DOCTYPE html>');
    });

    test('should contain esm.sh import map for React dependencies', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');
      const html = resource.text()!;

      // Must have an import map
      expect(html).toContain('<script type="importmap">');

      // Parse and validate the import map
      const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
      expect(mapMatch).toBeTruthy();
      const importMap = JSON.parse(mapMatch![1]);

      // React dependencies must point to esm.sh
      expect(importMap.imports['react']).toContain('esm.sh');
      expect(importMap.imports['react-dom/client']).toContain('esm.sh');
    });

    test('should contain bundled React component code', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');
      const html = resource.text()!;

      // Must have <script type="module"> with the bundled component
      expect(html).toContain('<script type="module">');

      // The bundled code must include the WeatherWidget component
      expect(html).toContain('WeatherWidget');
      // Must include imports from @frontmcp/ui (Card, Badge)
      expect(html).toContain('Card');
      expect(html).toContain('Badge');
      // Must include React mount code (createRoot)
      expect(html).toContain('createRoot');
    });

    test('should include MCP Apps bridge with __mcpAppsEnabled', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');
      const html = resource.text()!;

      // Bridge must be present for ext-apps communication
      expect(html).toContain('FrontMcpBridge');
      // __mcpAppsEnabled enables the ext-apps adapter
      expect(html).toContain('__mcpAppsEnabled');
      // Data injection globals
      expect(html).toContain('__mcpToolName');
      expect(html).toContain('__mcpToolOutput');
    });

    test('should NOT leak server filesystem paths in import statements', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');
      const html = resource.text()!;

      // No filesystem path imports (from "/.../file.js" or from "C:\...")
      expect(html).not.toMatch(/from\s+["']\/Users\//);
      expect(html).not.toMatch(/from\s+["']\/home\//);
      expect(html).not.toMatch(/from\s+["'][A-Z]:\\/);
      // No node_modules in import paths
      expect(html).not.toMatch(/from\s+["'][^"']*node_modules/);
    });

    test('should have React dependencies in esm.sh import map', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');
      const html = resource.text()!;

      const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
      expect(mapMatch).toBeTruthy();
      const importMap = JSON.parse(mapMatch![1]);

      // React must be loaded from esm.sh CDN
      expect(importMap.imports['react']).toContain('esm.sh');
      expect(importMap.imports['react-dom/client']).toContain('esm.sh');
    });

    test('should bundle @frontmcp/ui from local dist (not esm.sh)', async ({ mcp }) => {
      const resource = await mcp.resources.read('ui://widget/react-weather.html');
      const html = resource.text()!;

      // @frontmcp/ui components should be bundled inline (not external)
      // Verify by checking the bundled code contains the component implementations
      expect(html).toContain('WeatherWidget');
      expect(html).toContain('Card');
      expect(html).toContain('Badge');
      // Bridge reuse fix should be bundled
      expect(html).toContain('existingBridge');
    });
  });

  test.describe('FileSource React Widget — Tool Call', () => {
    test('should return structuredContent with weather data', async ({ mcp }) => {
      const result = await mcp.tools.call('react-weather', { location: 'London' });

      expect(result).toBeSuccessful();
      expect(result.raw.structuredContent).toBeDefined();

      const data = result.raw.structuredContent as Record<string, unknown>;
      expect(data.location).toBe('London');
      expect(data.temperature).toBe(14);
      expect(data.conditions).toBe('rainy');
      expect(data.icon).toBe('rainy');
    });

    test('should return text content for model consumption', async ({ mcp }) => {
      const result = await mcp.tools.call('react-weather', { location: 'Tokyo' });

      expect(result).toBeSuccessful();
      expect(result.hasTextContent()).toBe(true);
    });

    test('static mode should not include HTML in _meta', async ({ mcp }) => {
      const result = await mcp.tools.call('react-weather', { location: 'London' });

      expect(result).toBeSuccessful();
      // Static mode: widget is fetched via resources/read, not embedded in response
      expect(result.hasToolUI()).toBe(false);
      expect(result).toNotHaveMetaKey('ui/html');
    });
  });

  test.describe('FileSource React Widget — Discovery', () => {
    test('should appear in tools/list', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('react-weather');
    });

    test('should have ui.resourceUri in tools/list metadata', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const tools = await client.tools.list();
      const tool = tools.find((t) => t.name === 'react-weather');
      expect(tool).toBeDefined();

      const uiMeta = tool?._meta?.['ui'] as Record<string, unknown> | undefined;
      expect(uiMeta).toBeDefined();
      expect(uiMeta?.resourceUri).toBe('ui://widget/react-weather.html');

      await client.disconnect();
    });

    test('should have static-widget resource template listed', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();
      expect(templates).toContainResourceTemplate('ui://widget/{toolName}.html');
    });
  });
});
