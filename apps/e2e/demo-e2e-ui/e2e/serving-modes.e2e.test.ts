/**
 * E2E Tests for Serving Modes
 *
 * Tests the different serving modes:
 * - static: Pre-rendered HTML, no server calls (widget served via resource URL)
 * - hybrid: Pre-rendered shell with dynamic data (component payload in _meta)
 * - auto: Auto-detected based on client (already covered in platform-detection.e2e.test.ts)
 *
 * Platform support:
 * - OpenAI, ext-apps, Cursor: support static and hybrid
 * - Claude, Continue, Cody: only support inline (will skip UI for static/hybrid)
 * - Unknown, Gemini: no UI support
 *
 * Note: Static mode does not include UI in the response (_meta) because the widget
 * is pre-rendered at build time and served via a resource URL. The tool returns
 * JSON data which the platform uses to populate the pre-rendered widget.
 * Hybrid mode includes component payload in _meta['ui/component'].
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Serving Modes E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('Static Serving Mode', () => {
    /**
     * Static mode returns JSON data only - the widget is pre-rendered and served
     * via resource URL. hasToolUI() will be false because no UI metadata is in
     * the response. We verify the JSON data is returned correctly.
     */
    test.describe('Supported Platforms', () => {
      test('OpenAI should return JSON data for static badge', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'ChatGPT', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Status',
          value: 'Active',
          color: 'green',
        });

        expect(result).toBeSuccessful();
        // Static mode: UI is served via resource URL, not in response
        // So hasToolUI() is false, but JSON data is returned
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ label: string; value: string; color: string }>();
        expect(json.label).toBe('Status');
        expect(json.value).toBe('Active');
        expect(json.color).toBe('green');

        await client.disconnect();
      });

      test('Cursor should return JSON data for static badge', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Cursor', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Build',
          value: 'Passing',
          color: 'blue',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ label: string; value: string; color: string }>();
        expect(json.label).toBe('Build');
        expect(json.value).toBe('Passing');
        expect(json.color).toBe('blue');

        await client.disconnect();
      });

      test('ext-apps should return JSON data for static badge', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'openai-ext-apps', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Version',
          value: '2.0.0',
          color: 'yellow',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ label: string; value: string; color: string }>();
        expect(json.label).toBe('Version');
        expect(json.value).toBe('2.0.0');
        expect(json.color).toBe('yellow');

        await client.disconnect();
      });
    });

    test.describe('Unsupported Platforms (should return JSON only)', () => {
      test('Claude should skip UI for static mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Test',
          value: 'Value',
          color: 'red',
        });

        expect(result).toBeSuccessful();
        // Claude doesn't support static mode, so UI should be skipped
        // But the JSON data should still be returned correctly
        const json = result.json<{ label: string; value: string }>();
        expect(json.label).toBe('Test');
        expect(json.value).toBe('Value');

        await client.disconnect();
      });

      test('Continue should skip UI for static mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Continue', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Continue',
          value: 'Test',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ label: string; value: string }>();
        expect(json.label).toBe('Continue');

        await client.disconnect();
      });

      test('Cody should skip UI for static mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Sourcegraph Cody', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Cody',
          value: 'Test',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ label: string }>();
        expect(json.label).toBe('Cody');

        await client.disconnect();
      });

      test('Unknown client should return JSON only for static mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'UnknownClient', version: '1.0.0' },
        });

        const result = await client.tools.call('static-badge', {
          label: 'Unknown',
          value: 'Client',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ label: string; value: string }>();
        expect(json.label).toBe('Unknown');
        expect(json.value).toBe('Client');

        await client.disconnect();
      });
    });

    test.describe('Color Variants', () => {
      const colors = ['green', 'blue', 'red', 'yellow', 'gray'] as const;

      for (const color of colors) {
        test(`should render ${color} badge correctly`, async ({ server }) => {
          const client = await server.createClient({
            transport: 'streamable-http',
            clientInfo: { name: 'ChatGPT', version: '1.0.0' },
          });

          const result = await client.tools.call('static-badge', {
            label: 'Color',
            value: color,
            color,
          });

          expect(result).toBeSuccessful();
          const json = result.json<{ color: string }>();
          expect(json.color).toBe(color);

          await client.disconnect();
        });
      }
    });
  });

  test.describe('Hybrid Serving Mode', () => {
    test.describe('Supported Platforms', () => {
      test('OpenAI should render hybrid status with UI', async ({ server }) => {
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

        const json = result.json<{ serviceName: string; status: string; isHealthy: boolean }>();
        expect(json.serviceName).toBe('API Server');
        expect(json.status).toBe('healthy');
        expect(json.isHealthy).toBe(true);

        await client.disconnect();
      });

      test('Cursor should render hybrid status with UI', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Cursor', version: '1.0.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Database',
          status: 'degraded',
          uptime: 98.5,
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(true);

        const json = result.json<{ status: string; statusColor: string; isHealthy: boolean }>();
        expect(json.status).toBe('degraded');
        expect(json.statusColor).toBe('yellow');
        expect(json.isHealthy).toBe(false);

        await client.disconnect();
      });

      test('ext-apps should render hybrid status with UI', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'openai-ext-apps', version: '1.0.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Cache',
          status: 'down',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(true);

        const json = result.json<{ status: string; statusColor: string }>();
        expect(json.status).toBe('down');
        expect(json.statusColor).toBe('red');

        await client.disconnect();
      });
    });

    test.describe('Unsupported Platforms (should return JSON only)', () => {
      test('Claude should skip UI for hybrid mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Claude Service',
          status: 'healthy',
        });

        expect(result).toBeSuccessful();
        // Claude uses dual-payload mode (not widget), so hasToolUI is false for hybrid
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ serviceName: string; status: string }>();
        expect(json.serviceName).toBe('Claude Service');
        expect(json.status).toBe('healthy');

        await client.disconnect();
      });

      test('Continue should skip UI for hybrid mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Continue', version: '1.0.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Continue Service',
          status: 'degraded',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ serviceName: string }>();
        expect(json.serviceName).toBe('Continue Service');

        await client.disconnect();
      });

      test('generic-mcp should skip UI for hybrid mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'mcp-client', version: '1.0.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Generic Service',
          status: 'healthy',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ serviceName: string }>();
        expect(json.serviceName).toBe('Generic Service');

        await client.disconnect();
      });

      test('Gemini should skip UI for hybrid mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'Gemini', version: '1.0.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Gemini Service',
          status: 'healthy',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ serviceName: string }>();
        expect(json.serviceName).toBe('Gemini Service');

        await client.disconnect();
      });

      test('Unknown client should return JSON only for hybrid mode tool', async ({ server }) => {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'RandomClient', version: '0.1.0' },
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Unknown Service',
          status: 'down',
        });

        expect(result).toBeSuccessful();
        expect(result.hasToolUI()).toBe(false);
        const json = result.json<{ serviceName: string; status: string }>();
        expect(json.serviceName).toBe('Unknown Service');
        expect(json.status).toBe('down');

        await client.disconnect();
      });
    });

    test.describe('Status Variants', () => {
      const statuses = [
        { status: 'healthy', color: 'green', isHealthy: true },
        { status: 'degraded', color: 'yellow', isHealthy: false },
        { status: 'down', color: 'red', isHealthy: false },
      ] as const;

      for (const { status, color, isHealthy } of statuses) {
        test(`should render ${status} status with ${color} color`, async ({ server }) => {
          const client = await server.createClient({
            transport: 'streamable-http',
            clientInfo: { name: 'ChatGPT', version: '1.0.0' },
          });

          const result = await client.tools.call('hybrid-status', {
            serviceName: `Test ${status}`,
            status,
          });

          expect(result).toBeSuccessful();
          const json = result.json<{ statusColor: string; isHealthy: boolean }>();
          expect(json.statusColor).toBe(color);
          expect(json.isHealthy).toBe(isHealthy);

          await client.disconnect();
        });
      }
    });
  });

  test.describe('Cross-Platform Data Consistency', () => {
    test('static badge should return same data across all platforms', async ({ server }) => {
      const platforms = [
        { name: 'ChatGPT', version: '1.0.0' },
        { name: 'Claude Desktop', version: '1.0.0' },
        { name: 'Cursor', version: '1.0.0' },
        { name: 'Continue', version: '1.0.0' },
        { name: 'UnknownClient', version: '1.0.0' },
      ];

      for (const platform of platforms) {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: platform,
        });

        const result = await client.tools.call('static-badge', {
          label: 'Test',
          value: 'Consistency',
          color: 'blue',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ label: string; value: string; color: string }>();
        expect(json.label).toBe('Test');
        expect(json.value).toBe('Consistency');
        expect(json.color).toBe('blue');

        await client.disconnect();
      }
    });

    test('hybrid status should return same data across all platforms', async ({ server }) => {
      const platforms = [
        { name: 'ChatGPT', version: '1.0.0' },
        { name: 'Claude Desktop', version: '1.0.0' },
        { name: 'Cursor', version: '1.0.0' },
        { name: 'mcp-client', version: '1.0.0' },
      ];

      for (const platform of platforms) {
        const client = await server.createClient({
          transport: 'streamable-http',
          clientInfo: platform,
        });

        const result = await client.tools.call('hybrid-status', {
          serviceName: 'Consistent Service',
          status: 'healthy',
          uptime: 99.99,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ serviceName: string; status: string; uptime: number; isHealthy: boolean }>();
        expect(json.serviceName).toBe('Consistent Service');
        expect(json.status).toBe('healthy');
        expect(json.uptime).toBe(99.99);
        expect(json.isHealthy).toBe(true);

        await client.disconnect();
      }
    });
  });

  test.describe('Default Values', () => {
    test('static badge should use default gray color', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('static-badge', {
        label: 'Default',
        value: 'Color',
        // No color specified
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ color: string }>();
      expect(json.color).toBe('gray');

      await client.disconnect();
    });

    test('hybrid status should use default uptime', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('hybrid-status', {
        serviceName: 'Default Uptime',
        status: 'healthy',
        // No uptime specified
      });

      expect(result).toBeSuccessful();
      const json = result.json<{ uptime: number }>();
      expect(json.uptime).toBe(99.9);

      await client.disconnect();
    });
  });
});
