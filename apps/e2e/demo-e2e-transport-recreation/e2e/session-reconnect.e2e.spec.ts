/**
 * E2E Tests for Session Reconnect Behavior (Issue #280)
 *
 * Tests the Streamable HTTP reconnect flow when a client:
 * 1. Terminates a session via DELETE
 * 2. Sends a new initialize with the old (terminated) session ID
 *
 * Per MCP spec, clients SHOULD clear the session ID before re-initializing,
 * but FrontMCP is lenient and creates a fresh session instead of returning 404.
 *
 * Uses raw fetch for DELETE and initialize requests since McpTestClient
 * doesn't expose DELETE and always sends mcp-session-id when it has one.
 */
import { test, expect } from '@frontmcp/testing';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Send a DELETE request to terminate a session.
 */
async function sendDelete(baseUrl: string, sessionId: string): Promise<{ status: number }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'DELETE',
    headers: {
      'mcp-session-id': sessionId,
    },
  });
  return { status: response.status };
}

/**
 * Send an initialize request, optionally with a stale session ID.
 * Returns the HTTP status, new session ID from response header, and parsed body.
 */
async function sendInitialize(
  baseUrl: string,
  sessionId?: string,
): Promise<{ status: number; sessionId: string | null; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'reconnect-test', version: '1.0.0' },
      },
    }),
  });

  const newSessionId = response.headers.get('mcp-session-id');
  const text = await response.text();
  const body = parseSSEOrJSON(text);

  return { status: response.status, sessionId: newSessionId, body };
}

/**
 * Send a tools/list request with a specific session ID.
 */
async function sendToolsList(baseUrl: string, sessionId: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });

  const body = await response.text();
  return { status: response.status, body };
}

/**
 * Parse a response that may be SSE format or plain JSON.
 * SSE format: "event: message\ndata: {...}\n\n"
 */
function parseSSEOrJSON(text: string): Record<string, unknown> {
  // Try SSE format first
  const dataMatch = text.match(/^data: (.+)$/m);
  if (dataMatch) {
    try {
      return JSON.parse(dataMatch[1]) as Record<string, unknown>;
    } catch {
      // fall through to plain JSON
    }
  }

  // Try plain JSON
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

test.describe('Session Reconnect E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-transport-recreation/src/main.ts',
    project: 'demo-e2e-transport-recreation',
    publicMode: true,
  });

  test.describe('DELETE session termination', () => {
    test('should terminate session with DELETE and return 204', async ({ mcp, server }) => {
      // Verify session is working
      const result = await mcp.tools.call('get-session-info', {});
      expect(result).toBeSuccessful();

      const sessionId = mcp.sessionId;
      expect(sessionId).toBeTruthy();

      // DELETE the session
      const { status } = await sendDelete(server.info.baseUrl, sessionId);
      expect(status).toBe(204);
    });

    test('should return 404 for non-initialize requests after DELETE', async ({ mcp, server }) => {
      // Establish session
      const result = await mcp.tools.call('get-session-info', {});
      expect(result).toBeSuccessful();
      const sessionId = mcp.sessionId;

      // Terminate session
      const { status: deleteStatus } = await sendDelete(server.info.baseUrl, sessionId);
      expect(deleteStatus).toBe(204);

      // Try tools/list with the terminated session ID - should get 404
      const { status: listStatus } = await sendToolsList(server.info.baseUrl, sessionId);
      expect(listStatus).toBe(404);
    });
  });

  test.describe('Reconnect with stale session ID', () => {
    test('should allow initialize with terminated session ID and return new session', async ({ mcp, server }) => {
      // Establish session
      const result = await mcp.tools.call('get-session-info', {});
      expect(result).toBeSuccessful();
      const oldSessionId = mcp.sessionId;

      // Terminate session
      const { status: deleteStatus } = await sendDelete(server.info.baseUrl, oldSessionId);
      expect(deleteStatus).toBe(204);

      // Send initialize WITH the old (terminated) session ID
      // This should succeed (not 404) and return a new session
      const initResult = await sendInitialize(server.info.baseUrl, oldSessionId);
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();
    });

    test('new session after reconnect should have different session ID', async ({ mcp, server }) => {
      // Establish session
      await mcp.tools.call('get-session-info', {});
      const oldSessionId = mcp.sessionId;

      // Terminate and reconnect with stale session
      await sendDelete(server.info.baseUrl, oldSessionId);
      const initResult = await sendInitialize(server.info.baseUrl, oldSessionId);

      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).not.toBe(oldSessionId);
    });
  });

  test.describe('Clean reconnect (no stale session)', () => {
    test('should create new session when reconnecting without session header', async ({ mcp, server }) => {
      // Establish session
      await mcp.tools.call('get-session-info', {});
      const oldSessionId = mcp.sessionId;

      // Terminate session
      await sendDelete(server.info.baseUrl, oldSessionId);

      // Send initialize WITHOUT session header (clean reconnect per MCP spec)
      const initResult = await sendInitialize(server.info.baseUrl);
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();
      expect(initResult.sessionId).not.toBe(oldSessionId);
    });
  });

  test.describe('Session state after reconnect', () => {
    test('should not preserve counter state across session reconnect', async ({ mcp, server }) => {
      // Build up counter state in original session
      const r1 = await mcp.tools.call('increment-counter', { amount: 10 });
      expect(r1).toBeSuccessful();
      expect(r1).toHaveTextContent('"newValue":10');

      const r2 = await mcp.tools.call('increment-counter', { amount: 5 });
      expect(r2).toBeSuccessful();
      expect(r2).toHaveTextContent('"newValue":15');

      // Terminate and create fresh session via a new client
      const oldSessionId = mcp.sessionId;
      await sendDelete(server.info.baseUrl, oldSessionId);

      // Create a brand new client (fresh session)
      const newClient = await server.createClient();

      // Counter should start from 0 in new session (default increment is 1)
      const r3 = await newClient.tools.call('increment-counter', { amount: 1 });
      expect(r3).toBeSuccessful();
      expect(r3).toHaveTextContent('"previousValue":0');
      expect(r3).toHaveTextContent('"newValue":1');

      await newClient.disconnect();
    });
  });
});
