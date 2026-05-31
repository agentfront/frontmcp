/**
 * E2E Tests for Widget Sizing (#40)
 *
 * Verifies the portable widget sizing controls (`preferredHeight`, `minHeight`,
 * `maxHeight`, `aspectRatio`, `autoResize`) flow end-to-end:
 *
 * 1. tools/list discovery → `_meta.ui` carries the sizing hints.
 * 2. tool call response → `_meta` carries `ui/preferredHeight` etc.
 * 3. Emitted widget HTML carries the static sizing CSS, the injected
 *    `window.__mcpWidgetSizing` global, and the auto-resize runtime.
 *
 * The `html-card` fixture tool is configured with:
 *   preferredHeight: 320, minHeight: 120, maxHeight: 640,
 *   aspectRatio: '16 / 9', autoResize: true
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Widget Sizing E2E (#40)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test.describe('tools/list discovery metadata', () => {
    test('should carry sizing hints on _meta.ui', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'claude-desktop', version: '1.0.0' },
      });

      try {
        const tools = await client.tools.list();
        const tool = tools.find((t) => t.name === 'html-card');
        expect(tool).toBeDefined();

        const uiMeta = tool?._meta?.['ui'] as Record<string, unknown> | undefined;
        expect(uiMeta).toBeDefined();
        expect(uiMeta?.['preferredHeight']).toBe(320);
        expect(uiMeta?.['minHeight']).toBe(120);
        expect(uiMeta?.['maxHeight']).toBe(640);
        expect(uiMeta?.['aspectRatio']).toBe('16 / 9');
      } finally {
        await client.disconnect();
      }
    });

    test('should also carry sizing hints for ext-apps clients', async ({ server }) => {
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();

      try {
        const tools = await client.tools.list();
        const tool = tools.find((t) => t.name === 'html-card');
        expect(tool).toBeDefined();

        const uiMeta = tool?._meta?.['ui'] as Record<string, unknown> | undefined;
        expect(uiMeta).toBeDefined();
        expect(uiMeta?.['preferredHeight']).toBe(320);
        expect(uiMeta?.['aspectRatio']).toBe('16 / 9');
      } finally {
        await client.disconnect();
      }
    });
  });

  test.describe('tool call response _meta', () => {
    test('should carry ui/* sizing meta keys', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      try {
        const result = await client.tools.call('html-card', {
          title: 'Sized',
          content: 'Body',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveMetaValue('ui/preferredHeight', 320);
        expect(result).toHaveMetaValue('ui/minHeight', 120);
        expect(result).toHaveMetaValue('ui/maxHeight', 640);
        expect(result).toHaveMetaValue('ui/aspectRatio', '16 / 9');
      } finally {
        await client.disconnect();
      }
    });
  });

  test.describe('emitted widget HTML', () => {
    test('should embed sizing CSS, __mcpWidgetSizing, and the auto-resize runtime', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      try {
        const result = await client.tools.call('html-card', {
          title: 'Sized',
          content: 'Body',
        });

        expect(result).toBeSuccessful();
        const html = result.raw._meta?.['ui/html'] as string | undefined;
        expect(html).toBeDefined();

        // Static sizing CSS (numeric → px, string aspect-ratio verbatim).
        expect(html).toContain('height: 320px;');
        expect(html).toContain('min-height: 120px;');
        expect(html).toContain('max-height: 640px;');
        expect(html).toContain('aspect-ratio: 16 / 9;');

        // Injected sizing global the bridge reads.
        expect(html).toContain('window.__mcpWidgetSizing =');
        expect(html).toContain('"preferredHeight":320');

        // Auto-resize runtime present (ResizeObserver-guarded).
        expect(html).toContain('__initAutoResize');
        expect(html).toContain('ResizeObserver');
      } finally {
        await client.disconnect();
      }
    });
  });
});
