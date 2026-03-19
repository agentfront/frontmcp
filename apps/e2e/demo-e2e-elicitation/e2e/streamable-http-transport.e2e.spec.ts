/**
 * E2E Tests for Streamable HTTP Transport — Session ID & Elicitation
 *
 * Covers:
 * - Mcp-Session-Id response header presence
 * - Elicitation working correctly after prior requests (session state persistence)
 * - Elicitation capability persistence across requests
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Streamable HTTP Transport E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-elicitation/src/main.ts',
    project: 'demo-e2e-elicitation',
    publicMode: true,
  });

  // ═══════════════════════════════════════════════════════════════════
  // Mcp-Session-Id header
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Mcp-Session-Id header', () => {
    test('initialize response should include mcp-session-id header', async ({ server }) => {
      const url = `${server.info.baseUrl}/`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: { sampling: {} },
            clientInfo: { name: '@frontmcp/testing', version: '0.4.0' },
          },
        }),
      });

      expect(response.ok).toBe(true);

      const sessionId = response.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();
    });

    test('session ID should be sent on subsequent requests', async ({ mcp }) => {
      // After connect(), the client should have a session ID
      expect(mcp.sessionId).toBeTruthy();

      // Subsequent requests should work (session ID is sent automatically)
      const tools = await mcp.tools.list();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Elicitation in stateless HTTP mode
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Elicitation in stateless HTTP mode', () => {
    test('native elicitation should work on first tool call', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { confirmed: true },
      }));

      const result = await mcp.tools.call('confirm-action', {
        action: 'first-call test',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('confirmed and executed');
      // Should NOT fall back to instructions
      expect(result.text()).not.toContain('sendElicitationResult');
    });

    test('native elicitation should work after prior requests in same session', async ({ mcp }) => {
      // Exercise session state persistence with normal requests first
      const tools1 = await mcp.tools.list();
      expect(tools1.length).toBeGreaterThan(0);

      const tools2 = await mcp.tools.list();
      expect(tools2.length).toEqual(tools1.length);

      // Now trigger elicitation — must still work
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { confirmed: true },
      }));

      const result = await mcp.tools.call('confirm-action', {
        action: 'after-prior-requests test',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('confirmed and executed');
      expect(result.text()).not.toContain('sendElicitationResult');
    });

    test('server should NOT show sendElicitationResult for elicitation-capable client', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).not.toContain('sendElicitationResult');
    });

    test('non-supporting client should get fallback in stateless mode', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        const result = await noElicitClient.tools.call('confirm-action', {
          action: 'no-elicit test',
        });

        expect(result).toBeSuccessful();
        expect(result.text()).toContain('sendElicitationResult');
      } finally {
        await noElicitClient.disconnect();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Elicitation capability persistence across requests
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Elicitation capability persistence across requests', () => {
    test('capabilities should persist for multiple tool calls', async ({ mcp }) => {
      // First elicitation
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { confirmed: true },
      }));

      const result1 = await mcp.tools.call('confirm-action', { action: 'first' });
      expect(result1).toBeSuccessful();
      expect(result1.text()).toContain('confirmed and executed');
      expect(result1.text()).not.toContain('sendElicitationResult');

      // Second elicitation in same session
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { confirmed: true },
      }));

      const result2 = await mcp.tools.call('confirm-action', { action: 'second' });
      expect(result2).toBeSuccessful();
      expect(result2.text()).toContain('confirmed and executed');
      expect(result2.text()).not.toContain('sendElicitationResult');
    });

    test('server capabilities response should include elicitation', async ({ mcp }) => {
      const caps = mcp.capabilities as Record<string, unknown>;
      expect(caps.elicitation).toBeDefined();
    });
  });
});
