/**
 * E2E Tests for Session Initialize Behavior
 *
 * Tests the Streamable HTTP session management per MCP 2025-11-25 spec:
 *
 * initialize + valid signed mcp-session-id:
 *   - terminated → unmark, re-initialize under same session ID
 *   - active → MCP SDK rejects with 400 "Server already initialized"
 *   - missing → initialize with the provided session ID
 *
 * initialize + no/invalid mcp-session-id:
 *   - create new session with new ID
 *
 * non-initialize + terminated session:
 *   - 404 per MCP spec
 *
 * Uses raw fetch for DELETE and initialize requests since McpTestClient
 * doesn't expose DELETE and always sends mcp-session-id when it has one.
 */
import { test, expect } from '@frontmcp/testing';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function sendDelete(baseUrl: string, sessionId: string): Promise<{ status: number }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'DELETE',
    headers: { 'mcp-session-id': sessionId },
  });
  return { status: response.status };
}

async function sendInitialize(
  baseUrl: string,
  sessionId?: string,
  capabilities?: Record<string, unknown>,
): Promise<{ status: number; sessionId: string | null; body: ParsedResponse }> {
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
        capabilities: capabilities ?? {},
        clientInfo: { name: 'reconnect-test', version: '1.0.0' },
      },
    }),
  });

  const newSessionId = response.headers.get('mcp-session-id');
  const text = await response.text();
  const body = parseSSEOrJSON(text);
  return { status: response.status, sessionId: newSessionId, body };
}

async function sendToolsList(
  baseUrl: string,
  sessionId: string,
): Promise<{ status: number; body: string; responseSessionId: string | null }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await response.text();
  return { status: response.status, body, responseSessionId: response.headers.get('mcp-session-id') };
}

async function sendNotificationInitialized(baseUrl: string, sessionId: string): Promise<{ status: number }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return { status: response.status };
}

async function sendToolCall(
  baseUrl: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; body: ParsedResponse; sessionId: string | null }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  const newSessionId = response.headers.get('mcp-session-id');
  const text = await response.text();
  const body = parseSSEOrJSON(text);
  return { status: response.status, body, sessionId: newSessionId };
}

async function sendSseGet(baseUrl: string, sessionId: string): Promise<{ status: number; contentType: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${baseUrl}/`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId },
      signal: controller.signal,
    });
    return { status: response.status, contentType: response.headers.get('content-type') };
  } finally {
    clearTimeout(timer);
  }
}

type ParsedJsonResponse = Record<string, unknown>;
type ParseFailure = { raw: string };
type ParsedResponse = ParsedJsonResponse | ParseFailure;

function parseSSEOrJSON(text: string): ParsedResponse {
  const dataMatch = text.match(/^data: (.+)$/m);
  if (dataMatch) {
    try {
      return JSON.parse(dataMatch[1]) as ParsedJsonResponse;
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(text) as ParsedJsonResponse;
  } catch {
    return { raw: text };
  }
}

function extractToolOutputJson<T>(body: ParsedResponse): T {
  const rpc = body as Record<string, unknown>;
  const result = rpc['result'] as Record<string, unknown>;
  const content = result['content'] as Array<{ text: string }>;
  return JSON.parse(content[0].text) as T;
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

test.describe('Session Management E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-transport-recreation/src/main.ts',
    project: 'demo-e2e-transport-recreation',
    publicMode: true,
  });

  // ─── DELETE session termination ────────────────────────────────

  test.describe('DELETE session termination', () => {
    test('should terminate session with DELETE and return 204', async ({ mcp, server }) => {
      const result = await mcp.tools.call('get-session-info', {});
      expect(result).toBeSuccessful();

      const sessionId = mcp.sessionId;
      expect(sessionId).toBeTruthy();

      const { status } = await sendDelete(server.info.baseUrl, sessionId);
      expect(status).toBe(204);
    });

    test('should return 404 for tools/list after DELETE', async ({ mcp, server }) => {
      await mcp.tools.call('get-session-info', {});
      const sessionId = mcp.sessionId;

      await sendDelete(server.info.baseUrl, sessionId);

      const { status } = await sendToolsList(server.info.baseUrl, sessionId);
      expect(status).toBe(404);
    });

    test('should return 404 for tools/call after DELETE', async ({ mcp, server }) => {
      await mcp.tools.call('get-session-info', {});
      const sessionId = mcp.sessionId;

      await sendDelete(server.info.baseUrl, sessionId);

      const { status } = await sendToolCall(server.info.baseUrl, sessionId, 'get-session-info');
      expect(status).toBe(404);
    });

    test('should return 404 for notifications/initialized after DELETE', async ({ mcp, server }) => {
      await mcp.tools.call('get-session-info', {});
      const sessionId = mcp.sessionId;

      await sendDelete(server.info.baseUrl, sessionId);

      const { status } = await sendNotificationInitialized(server.info.baseUrl, sessionId);
      expect(status).toBe(404);
    });
  });

  // ─── Re-initialize terminated session (same session ID) ───────

  test.describe('Re-initialize terminated session', () => {
    test('should allow initialize with terminated session ID and return 200', async ({ mcp, server }) => {
      await mcp.tools.call('get-session-info', {});
      const oldSessionId = mcp.sessionId;

      await sendDelete(server.info.baseUrl, oldSessionId);

      const initResult = await sendInitialize(server.info.baseUrl, oldSessionId);
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();
    });

    test('should reuse the same session ID after re-initialize with valid signed session', async ({ mcp, server }) => {
      await mcp.tools.call('get-session-info', {});
      const oldSessionId = mcp.sessionId;

      await sendDelete(server.info.baseUrl, oldSessionId);

      const initResult = await sendInitialize(server.info.baseUrl, oldSessionId);
      expect(initResult.status).toBe(200);
      // Session ID should be reused (same signed ID)
      expect(initResult.sessionId).toBe(oldSessionId);
    });

    test('should allow subsequent requests after re-initialize with same session ID', async ({ mcp, server }) => {
      await mcp.tools.call('get-session-info', {});
      const sessionId = mcp.sessionId;

      // DELETE → re-initialize with same session ID
      await sendDelete(server.info.baseUrl, sessionId);
      const initResult = await sendInitialize(server.info.baseUrl, sessionId);
      expect(initResult.status).toBe(200);

      const usedSessionId = initResult.sessionId!;

      // Send notifications/initialized — should work (session unmarked from terminated)
      const notif = await sendNotificationInitialized(server.info.baseUrl, usedSessionId);
      expect(notif.status).toBe(202);

      // tools/list should work
      const list = await sendToolsList(server.info.baseUrl, usedSessionId);
      expect(list.status).toBe(200);
    });

    test('should start with fresh state when using a NEW session after DELETE', async ({ mcp, server }) => {
      // Build up counter state
      await mcp.tools.call('increment-counter', { amount: 10 });
      await mcp.tools.call('increment-counter', { amount: 5 });
      const sessionId = mcp.sessionId;

      // DELETE → fresh initialize WITHOUT old session ID
      await sendDelete(server.info.baseUrl, sessionId);
      const initResult = await sendInitialize(server.info.baseUrl);
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).not.toBe(sessionId);
      const newSessionId = initResult.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, newSessionId);

      // Counter should start from 0 in the brand new session
      const tool = await sendToolCall(server.info.baseUrl, newSessionId, 'increment-counter', { amount: 1 });
      expect(tool.status).toBe(200);
      const output = extractToolOutputJson<{ previousValue: number }>(tool.body);
      expect(output.previousValue).toBe(0);
    });

    test('should handle multiple DELETE + re-initialize cycles', async ({ server }) => {
      // Cycle 1
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sid1 = init1.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid1);

      await sendDelete(server.info.baseUrl, sid1);
      const reinit1 = await sendInitialize(server.info.baseUrl, sid1);
      expect(reinit1.status).toBe(200);
      const rsid1 = reinit1.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, rsid1);

      // Verify session works
      const list1 = await sendToolsList(server.info.baseUrl, rsid1);
      expect(list1.status).toBe(200);

      // Cycle 2
      await sendDelete(server.info.baseUrl, rsid1);
      const reinit2 = await sendInitialize(server.info.baseUrl, rsid1);
      expect(reinit2.status).toBe(200);
      const rsid2 = reinit2.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, rsid2);

      const list2 = await sendToolsList(server.info.baseUrl, rsid2);
      expect(list2.status).toBe(200);
    });
  });

  // ─── Initialize on active session (400) ───────────────────────

  test.describe('Initialize on active session', () => {
    test('should reject re-initialization on active session with 400', async ({ server }) => {
      // Initialize first session
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sessionId = init1.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sessionId);

      // Verify session is active
      const list = await sendToolsList(server.info.baseUrl, sessionId);
      expect(list.status).toBe(200);

      // Try to re-initialize on the SAME active session
      const init2 = await sendInitialize(server.info.baseUrl, sessionId);
      expect(init2.status).toBe(400);
    });
  });

  // ─── Fresh initialize (no session ID) ─────────────────────────

  test.describe('Fresh initialize (no session ID)', () => {
    test('should create new session when no mcp-session-id header', async ({ server }) => {
      const initResult = await sendInitialize(server.info.baseUrl);
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();
    });

    test('fresh session should be independent from terminated session', async ({ mcp, server }) => {
      await mcp.tools.call('increment-counter', { amount: 10 });
      const oldSessionId = mcp.sessionId;
      await sendDelete(server.info.baseUrl, oldSessionId);

      // Fresh initialize WITHOUT old session ID → new independent session
      const initResult = await sendInitialize(server.info.baseUrl);
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).not.toBe(oldSessionId);
    });
  });

  // ─── Invalid / forged session IDs ─────────────────────────────

  test.describe('Invalid session IDs', () => {
    test('should handle initialize with unrecognized session ID', async ({ server }) => {
      // In public/anonymous mode, any session ID header is accepted as the session key.
      // In authenticated mode, invalid signatures would cause rejection.
      const initResult = await sendInitialize(server.info.baseUrl, 'totally-invalid-forged-session-id');
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();
    });

    test('should return 404 for non-initialize with invalid session ID', async ({ server }) => {
      const { status } = await sendToolsList(server.info.baseUrl, 'invalid-session-id-does-not-exist');
      // Should fail — either 404 (terminated check) or 400 (session validation)
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── Session isolation ─────────────────────────────────────────

  test.describe('Session isolation', () => {
    test('deleting one session should not affect another', async ({ server }) => {
      const clientA = await server.createClient();
      const clientB = await server.createClient();

      await clientA.tools.call('increment-counter', { amount: 5 });
      await clientB.tools.call('increment-counter', { amount: 10 });

      // Delete session A
      await sendDelete(server.info.baseUrl, clientA.sessionId);

      // Session B should still work
      const result = await clientB.tools.call('increment-counter', { amount: 1 });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"previousValue":10');

      await clientA.disconnect();
      await clientB.disconnect();
    });
  });

  // ─── Full protocol handshake ───────────────────────────────────

  test.describe('Full protocol handshake', () => {
    test('full DELETE → re-initialize → handshake → work cycle', async ({ server }) => {
      // Step 1: Full initial handshake
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sessionId = init1.sessionId!;
      const notif1 = await sendNotificationInitialized(server.info.baseUrl, sessionId);
      expect(notif1.status).toBe(202);

      // Step 2: Use the session
      const list1 = await sendToolsList(server.info.baseUrl, sessionId);
      expect(list1.status).toBe(200);
      const tool1 = await sendToolCall(server.info.baseUrl, sessionId, 'increment-counter', { amount: 5 });
      expect(tool1.status).toBe(200);

      // Step 3: DELETE
      const del = await sendDelete(server.info.baseUrl, sessionId);
      expect(del.status).toBe(204);

      // Step 4: Re-initialize with same session ID
      const init2 = await sendInitialize(server.info.baseUrl, sessionId);
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId!;

      const notif2 = await sendNotificationInitialized(server.info.baseUrl, sessionId2);
      expect(notif2.status).toBe(202);

      // Step 5: Session works after re-initialize
      const list2 = await sendToolsList(server.info.baseUrl, sessionId2);
      expect(list2.status).toBe(200);
      const tool2 = await sendToolCall(server.info.baseUrl, sessionId2, 'increment-counter', { amount: 1 });
      expect(tool2.status).toBe(200);
    });

    test('session ID in tool context matches header after re-initialize', async ({ server }) => {
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sessionId = init1.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sessionId);

      // Verify session ID in tool context
      const tool1 = await sendToolCall(server.info.baseUrl, sessionId, 'get-session-info');
      expect(tool1.status).toBe(200);
      const info1 = extractToolOutputJson<{ sessionId: string }>(tool1.body);
      expect(info1.sessionId).not.toContain('fallback');

      // DELETE → re-initialize
      await sendDelete(server.info.baseUrl, sessionId);
      const init2 = await sendInitialize(server.info.baseUrl, sessionId);
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sessionId2);

      // Session ID in tool context should match
      const tool2 = await sendToolCall(server.info.baseUrl, sessionId2, 'get-session-info');
      expect(tool2.status).toBe(200);
      const info2 = extractToolOutputJson<{ sessionId: string; hasSession: boolean }>(tool2.body);
      expect(info2.sessionId).toBe(sessionId2);
      expect(info2.hasSession).toBe(true);
    });
  });

  // ─── Capabilities through reconnect ────────────────────────────

  test.describe('Capabilities through reconnect', () => {
    test('should accept initialize with elicitation capabilities', async ({ server }) => {
      const initResult = await sendInitialize(server.info.baseUrl, undefined, {
        elicitation: { form: {} },
      });
      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();

      const body = initResult.body as Record<string, unknown>;
      expect(body['result']).toBeDefined();
      const result = body['result'] as Record<string, unknown>;
      expect(result['protocolVersion']).toBeDefined();
      expect(result['capabilities']).toBeDefined();
      expect(result['serverInfo']).toBeDefined();
    });

    test('should accept re-initialize with different capabilities after DELETE', async ({ server }) => {
      // Initialize without elicitation
      const init1 = await sendInitialize(server.info.baseUrl, undefined, {});
      expect(init1.status).toBe(200);
      const sessionId = init1.sessionId!;

      // DELETE
      await sendDelete(server.info.baseUrl, sessionId);

      // Re-initialize with elicitation capabilities
      const init2 = await sendInitialize(server.info.baseUrl, sessionId, {
        elicitation: { form: {} },
      });
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId!;

      // Verify session works
      const list = await sendToolsList(server.info.baseUrl, sessionId2);
      expect(list.status).toBe(200);
    });
  });

  // ─── Concurrent operations ─────────────────────────────────────

  test.describe('Concurrent operations', () => {
    test('should handle concurrent requests on a valid session', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.status).toBe(200);
      const sessionId = init.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sessionId);

      const [r1, r2, r3] = await Promise.all([
        sendToolCall(server.info.baseUrl, sessionId, 'increment-counter', { amount: 1 }),
        sendToolCall(server.info.baseUrl, sessionId, 'increment-counter', { amount: 2 }),
        sendToolCall(server.info.baseUrl, sessionId, 'increment-counter', { amount: 3 }),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);
    });
  });

  // ─── Multi-cycle reconnect (double/triple DELETE+init) ──────────

  test.describe('Multi-cycle reconnect', () => {
    test('should handle triple DELETE + reconnect cycle with same session ID', async ({ server }) => {
      // Cycle 1: Fresh connect
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sid = init1.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid);

      const list1 = await sendToolsList(server.info.baseUrl, sid);
      expect(list1.status).toBe(200);

      // Cycle 2: DELETE → re-initialize with same session ID
      const del1 = await sendDelete(server.info.baseUrl, sid);
      expect(del1.status).toBe(204);

      const reinit1 = await sendInitialize(server.info.baseUrl, sid);
      expect(reinit1.status).toBe(200);
      const sid2 = reinit1.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid2);

      const list2 = await sendToolsList(server.info.baseUrl, sid2);
      expect(list2.status).toBe(200);

      // Cycle 3: DELETE → re-initialize again (the double-reconnect case)
      const del2 = await sendDelete(server.info.baseUrl, sid2);
      expect(del2.status).toBe(204);

      const reinit2 = await sendInitialize(server.info.baseUrl, sid2);
      expect(reinit2.status).toBe(200);
      const sid3 = reinit2.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid3);

      const list3 = await sendToolsList(server.info.baseUrl, sid3);
      expect(list3.status).toBe(200);

      // Cycle 4: Third DELETE + re-initialize (triple-reconnect)
      const del3 = await sendDelete(server.info.baseUrl, sid3);
      expect(del3.status).toBe(204);

      const reinit3 = await sendInitialize(server.info.baseUrl, sid3);
      expect(reinit3.status).toBe(200);
      const sid4 = reinit3.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid4);

      // Verify everything works at the end
      const list4 = await sendToolsList(server.info.baseUrl, sid4);
      expect(list4.status).toBe(200);

      const tool = await sendToolCall(server.info.baseUrl, sid4, 'get-session-info');
      expect(tool.status).toBe(200);
    });

    test('should not return 404 on second DELETE after re-initialize', async ({ server }) => {
      // This is the exact bug scenario: after re-initialize, the server
      // is not re-registered with NotificationService, causing the second
      // DELETE to return 404 because terminateSession.unregisterServer fails.
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.status).toBe(200);
      const sid = init.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid);

      // First DELETE
      const del1 = await sendDelete(server.info.baseUrl, sid);
      expect(del1.status).toBe(204);

      // Re-initialize with same session ID
      const reinit = await sendInitialize(server.info.baseUrl, sid);
      expect(reinit.status).toBe(200);
      const sid2 = reinit.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid2);

      // Second DELETE — MUST be 204, NOT 404
      const del2 = await sendDelete(server.info.baseUrl, sid2);
      expect(del2.status).toBe(204);

      // Should be able to reconnect again after second DELETE
      const reinit2 = await sendInitialize(server.info.baseUrl, sid2);
      expect(reinit2.status).toBe(200);
    });

    test('should handle rapid DELETE + reconnect without waiting', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.status).toBe(200);
      const sid = init.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sid);

      // Rapid cycle without waiting for SSE/logging
      for (let i = 0; i < 5; i++) {
        const del = await sendDelete(server.info.baseUrl, sid);
        expect(del.status).toBe(204);

        const reinit = await sendInitialize(server.info.baseUrl, sid);
        expect(reinit.status).toBe(200);
      }

      // Final session should work
      const list = await sendToolsList(server.info.baseUrl, sid);
      expect(list.status).toBe(200);
    });
  });

  // ─── SSE listener behavior ─────────────────────────────────────

  test.describe('SSE listener', () => {
    test('should accept SSE GET with valid session ID', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.status).toBe(200);
      const sessionId = init.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sessionId);

      const sse = await sendSseGet(server.info.baseUrl, sessionId);
      expect(sse.status).toBe(200);
      expect(sse.contentType).toContain('text/event-stream');
    });

    test('should reject SSE GET with terminated session ID', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.status).toBe(200);
      const sessionId = init.sessionId!;
      await sendNotificationInitialized(server.info.baseUrl, sessionId);

      await sendDelete(server.info.baseUrl, sessionId);

      const sse = await sendSseGet(server.info.baseUrl, sessionId);
      expect(sse.status).toBe(404);
    });
  });
});
