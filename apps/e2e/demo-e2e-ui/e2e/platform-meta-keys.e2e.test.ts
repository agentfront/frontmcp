/**
 * E2E Tests for Platform-Specific Meta Keys
 *
 * Tests that all platforms receive the correct ui/* meta key namespace
 * per the MCP Apps specification. OpenAI now uses the same ui/* namespace
 * as all other platforms (no more openai/* keys).
 *
 * These tests verify namespace isolation — no platform should receive
 * openai/* or frontmcp/* keys (no cross-contamination).
 */
import { test, expect, UIAssertions } from '@frontmcp/testing';

test.describe('Platform Meta Keys E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test.describe('OpenAI Platform Meta Keys', () => {
    test('should have ui/* meta keys in tool call response', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'OpenAI Test',
        content: 'Testing OpenAI meta keys',
      });

      expect(result).toBeSuccessful();

      // Verify ui/* keys are present (OpenAI now uses standard namespace)
      expect(result).toHaveMetaKey('ui/html');
      expect(result).toHaveMetaKey('ui/mimeType');

      // Verify correct MIME type
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('should NOT have openai/* or frontmcp/* keys for OpenAI', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('react-chart', {
        data: [{ label: 'A', value: 10 }],
        title: 'OpenAI Chart',
      });

      expect(result).toBeSuccessful();

      // Verify NO openai/* keys (unified to ui/* namespace)
      expect(result).toNotHaveMetaKey('openai/html');
      expect(result).toNotHaveMetaKey('openai/mimeType');

      // Verify NO frontmcp/* keys
      expect(result).toNotHaveMetaKey('frontmcp/html');
      expect(result).toNotHaveMetaKey('frontmcp/mimeType');

      // Verify ui/* keys ARE present (positive assertion)
      expect(result).toHaveMetaKey('ui/html');
      expect(result).toHaveMetaKey('ui/mimeType');

      await client.disconnect();
    });

    test('should have platform meta for OpenAI (comprehensive)', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'OpenAI', version: '2.0.0' },
      });

      const result = await client.tools.call('html-table', {
        headers: ['A', 'B'],
        rows: [['1', '2']],
      });

      expect(result).toBeSuccessful();
      expect(result).toHavePlatformMeta('openai');
      expect(result).toHavePlatformMimeType('openai');
      expect(result).toHavePlatformHtml('openai');

      await client.disconnect();
    });
  });

  // ext-apps platform detection requires the 'io.modelcontextprotocol/ui' capability
  // to be sent during MCP initialization. Using withPlatform('ext-apps') automatically
  // sets both the clientInfo and the required capability.
  test.describe('ext-apps Platform Meta Keys (SEP-1865)', () => {
    test('should have ui/* meta keys for ext-apps client', async ({ server }) => {
      // Use withPlatform to auto-set clientInfo AND capabilities for ext-apps
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();

      const result = await client.tools.call('html-card', {
        title: 'ext-apps Test',
        content: 'Testing SEP-1865 meta keys',
      });

      expect(result).toBeSuccessful();

      // Verify ui/* keys are present per SEP-1865
      expect(result).toHaveMetaKey('ui/html');
      expect(result).toHaveMetaKey('ui/mimeType');

      // Verify correct MIME type
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('should NOT have openai/* or frontmcp/* keys for ext-apps', async ({ server }) => {
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();

      const result = await client.tools.call('react-form', {
        fields: [{ name: 'test', type: 'text', label: 'Test' }],
      });

      expect(result).toBeSuccessful();

      // Verify NO openai/* keys (namespace isolation)
      expect(result).toNotHaveMetaKey('openai/html');
      expect(result).toNotHaveMetaKey('openai/mimeType');

      // Verify NO frontmcp/* keys
      expect(result).toNotHaveMetaKey('frontmcp/html');
      expect(result).toNotHaveMetaKey('frontmcp/mimeType');

      await client.disconnect();
    });

    test('should have platform meta for ext-apps (comprehensive)', async ({ server }) => {
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();

      const result = await client.tools.call('markdown-list', {
        title: 'ext-apps List',
        items: [{ text: 'Item 1', completed: true }],
      });

      expect(result).toBeSuccessful();
      expect(result).toHavePlatformMeta('ext-apps');
      expect(result).toHavePlatformMimeType('ext-apps');
      expect(result).toHavePlatformHtml('ext-apps');

      await client.disconnect();
    });
  });

  test.describe('Other Platforms Meta Keys (Claude, Cursor, etc.)', () => {
    test('should have ui/* keys only for Claude (no frontmcp/* duplication)', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'claude-desktop', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Claude Test',
        content: 'Testing ui/* meta keys',
      });

      expect(result).toBeSuccessful();

      // Verify ui/* keys are present
      expect(result).toHaveMetaKey('ui/html');
      expect(result).toHaveMetaKey('ui/mimeType');

      // Verify NO frontmcp/* keys (no duplication)
      expect(result).toNotHaveMetaKey('frontmcp/html');
      expect(result).toNotHaveMetaKey('frontmcp/mimeType');

      // Verify correct MIME type
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('should NOT have openai/* keys for Claude', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      });

      const result = await client.tools.call('react-chart', {
        data: [{ label: 'X', value: 50 }],
        title: 'Claude Chart',
      });

      expect(result).toBeSuccessful();

      // Verify NO openai/* keys (namespace isolation)
      expect(result).toNotHaveMetaKey('openai/html');
      expect(result).toNotHaveMetaKey('openai/mimeType');

      await client.disconnect();
    });

    test('should have ui/* keys only for Cursor (no frontmcp/* duplication)', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'cursor', version: '1.0.0' },
      });

      const result = await client.tools.call('mdx-doc', {
        title: 'Cursor Doc',
        sections: [{ heading: 'Section', content: 'Content' }],
      });

      expect(result).toBeSuccessful();

      // Verify ui/* keys are present
      expect(result).toHaveMetaKey('ui/html');
      expect(result).toHaveMetaKey('ui/mimeType');

      // Verify NO frontmcp/* keys (no duplication)
      expect(result).toNotHaveMetaKey('frontmcp/html');
      expect(result).toNotHaveMetaKey('frontmcp/mimeType');

      // Verify NO openai/* keys
      expect(result).toNotHaveMetaKey('openai/html');

      await client.disconnect();
    });

    test('should have platform meta for Claude (comprehensive)', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'claude-desktop', version: '1.0.0' },
      });

      const result = await client.tools.call('html-table', {
        headers: ['Name', 'Value'],
        rows: [['Test', '123']],
      });

      expect(result).toBeSuccessful();
      expect(result).toHavePlatformMeta('claude');
      expect(result).toHavePlatformMimeType('claude');
      expect(result).toHavePlatformHtml('claude');

      await client.disconnect();
    });
  });

  test.describe('Unknown Platform Meta Keys', () => {
    test('should have ui/* keys only for unknown platforms (no frontmcp/* duplication)', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'UnknownClient', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', {
        title: 'Unknown Test',
        content: 'Testing unknown platform',
      });

      expect(result).toBeSuccessful();

      // Unknown platforms get ui/* keys only (no frontmcp/* duplication)
      expect(result).toHaveMetaKey('ui/html');
      expect(result).toNotHaveMetaKey('frontmcp/html');

      // Verify NO openai/* keys
      expect(result).toNotHaveMetaKey('openai/html');

      await client.disconnect();
    });
  });

  test.describe('Cross-Platform Namespace Isolation', () => {
    test('should maintain namespace isolation — all platforms use ui/* keys', async ({ server }) => {
      // All platforms now use the same ui/* namespace
      const [openaiClient, claudeClient, cursorClient] = await Promise.all([
        server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'ChatGPT', version: '1.0.0' },
        }),
        server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'claude-desktop', version: '1.0.0' },
        }),
        server.createClient({
          transport: 'streamable-http',
          clientInfo: { name: 'cursor', version: '1.0.0' },
        }),
      ]);

      const [openaiResult, claudeResult, cursorResult] = await Promise.all([
        openaiClient.tools.call('html-card', { title: 'OpenAI', content: 'Test' }),
        claudeClient.tools.call('html-card', { title: 'Claude', content: 'Test' }),
        cursorClient.tools.call('html-card', { title: 'Cursor', content: 'Test' }),
      ]);

      // OpenAI: ui/* keys only (unified namespace)
      expect(openaiResult).toHaveMetaKey('ui/html');
      expect(openaiResult).toNotHaveMetaKey('openai/html');
      expect(openaiResult).toNotHaveMetaKey('frontmcp/html');

      // Claude: ui/* keys only
      expect(claudeResult).toHaveMetaKey('ui/html');
      expect(claudeResult).toNotHaveMetaKey('frontmcp/html');
      expect(claudeResult).toNotHaveMetaKey('openai/html');

      // Cursor: ui/* keys only (same as Claude)
      expect(cursorResult).toHaveMetaKey('ui/html');
      expect(cursorResult).toNotHaveMetaKey('frontmcp/html');
      expect(cursorResult).toNotHaveMetaKey('openai/html');

      await Promise.all([openaiClient.disconnect(), claudeClient.disconnect(), cursorClient.disconnect()]);
    });

    test('should use platform assertions for validation', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-table', {
        headers: ['A'],
        rows: [['1']],
      });

      expect(result).toBeSuccessful();

      // Use UIAssertions for comprehensive validation
      UIAssertions.assertOpenAIMeta(result);
      UIAssertions.assertPlatformMimeType(result, 'openai');
      const html = UIAssertions.assertPlatformHtml(result, 'openai');
      expect(html).toContain('table');

      await client.disconnect();
    });
  });

  test.describe('MIME Type Verification', () => {
    test('OpenAI should use text/html;profile=mcp-app', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'ChatGPT', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', { title: 'Test', content: 'Content' });

      expect(result).toBeSuccessful();
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('ext-apps should use text/html;profile=mcp-app', async ({ server }) => {
      // Use withPlatform to auto-set clientInfo AND capabilities for ext-apps
      const client = await server
        .createClientBuilder()
        .withTransport('streamable-http')
        .withPlatform('ext-apps')
        .buildAndConnect();

      const result = await client.tools.call('html-card', { title: 'Test', content: 'Content' });

      expect(result).toBeSuccessful();
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('Cursor should use text/html;profile=mcp-app', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'cursor', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', { title: 'Test', content: 'Content' });

      expect(result).toBeSuccessful();
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');

      await client.disconnect();
    });

    test('Claude should use text/html;profile=mcp-app', async ({ server }) => {
      const client = await server.createClient({
        transport: 'streamable-http',
        clientInfo: { name: 'claude-desktop', version: '1.0.0' },
      });

      const result = await client.tools.call('html-card', { title: 'Test', content: 'Content' });

      expect(result).toBeSuccessful();
      // Claude uses ui/* namespace only (no frontmcp/* duplication)
      expect(result).toHaveMetaValue('ui/mimeType', 'text/html;profile=mcp-app');
      expect(result).toNotHaveMetaKey('frontmcp/mimeType');

      await client.disconnect();
    });
  });
});
