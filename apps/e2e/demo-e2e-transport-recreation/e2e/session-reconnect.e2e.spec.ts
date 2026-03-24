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

/**
 * Send a tools/list request with a specific session ID.
 */
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
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });

  const body = await response.text();
  return { status: response.status, body, responseSessionId: response.headers.get('mcp-session-id') };
}

/**
 * Send a raw POST request with custom headers (for malformed header tests).
 */
async function sendRawPost(
  baseUrl: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

/**
 * Send a GET request with SSE Accept header (for SSE listener tests).
 */
async function sendSseGet(baseUrl: string, sessionId: string): Promise<{ status: number; contentType: string | null }> {
  const controller = new AbortController();
  // Abort after 2s to avoid hanging on SSE stream
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${baseUrl}/`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'mcp-session-id': sessionId,
      },
      signal: controller.signal,
    });
    return { status: response.status, contentType: response.headers.get('content-type') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a notifications/initialized notification with a specific session ID.
 */
async function sendNotificationInitialized(baseUrl: string, sessionId: string): Promise<{ status: number }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
  return { status: response.status };
}

/**
 * Send a tools/call request with a specific session ID.
 * Returns status, parsed body, and response session ID.
 */
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

/** Successful parse result with arbitrary JSON-RPC fields. */
type ParsedJsonResponse = Record<string, unknown>;

/** Failure sentinel returned when neither SSE nor JSON parsing succeeds. */
type ParseFailure = { raw: string };

/** Discriminated return type for {@link parseSSEOrJSON}. */
type ParsedResponse = ParsedJsonResponse | ParseFailure;

/**
 * Parse a response that may be SSE format or plain JSON.
 * SSE format: `event: message\ndata: {...}\n\n`
 *
 * On parse failure, returns `{ raw: string }` containing the original text
 * so callers can discriminate via the `'raw' in result` check.
 */
function parseSSEOrJSON(text: string): ParsedResponse {
  // Try SSE format first
  const dataMatch = text.match(/^data: (.+)$/m);
  if (dataMatch) {
    try {
      return JSON.parse(dataMatch[1]) as ParsedJsonResponse;
    } catch {
      // fall through to plain JSON
    }
  }

  // Try plain JSON
  try {
    return JSON.parse(text) as ParsedJsonResponse;
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

  // NOTE: These tests verify that the reconnect flow accepts and round-trips
  // client capabilities without errors, but do NOT assert capability-dependent
  // behavior (e.g. elicitation prompts). This E2E project has no elicitation
  // tools enabled, and the MCP initialize response only returns *server*
  // capabilities — client capabilities aren't echoed back. Capability-dependent
  // assertions live in demo-e2e-elicitation/e2e/elicitation.e2e.spec.ts
  // ("elicitation after session reconnect" describe block).
  test.describe('Capabilities preservation through reconnect', () => {
    test('should accept initialize with elicitation capabilities', async ({ server }) => {
      const initResult = await sendInitialize(server.info.baseUrl, undefined, {
        elicitation: { form: {} },
      });

      expect(initResult.status).toBe(200);
      expect(initResult.sessionId).toBeTruthy();
      expect('raw' in initResult.body).toBe(false);

      // Verify server responded with valid initialize result
      const body = initResult.body as Record<string, unknown>;
      expect(body['result']).toBeDefined();
      const result = body['result'] as Record<string, unknown>;
      expect(result['protocolVersion']).toBeDefined();
      expect(result['capabilities']).toBeDefined();
      expect(result['serverInfo']).toBeDefined();
    });

    test('should preserve session validity after reconnect with capabilities', async ({ server }) => {
      // Step 1: Initialize with elicitation capabilities
      const init1 = await sendInitialize(server.info.baseUrl, undefined, {
        elicitation: { form: {} },
        roots: { listChanged: true },
      });
      expect(init1.status).toBe(200);
      const sessionId1 = init1.sessionId;
      expect(sessionId1).toBeTruthy();
      if (!sessionId1) throw new Error('Expected sessionId after initialize');

      // Step 2: Verify session works (tools/list)
      const listResult = await sendToolsList(server.info.baseUrl, sessionId1);
      expect(listResult.status).toBe(200);

      // Step 3: Terminate session
      const { status: deleteStatus } = await sendDelete(server.info.baseUrl, sessionId1);
      expect(deleteStatus).toBe(204);

      // Step 4: Re-initialize with stale session ID to exercise reconnect path
      const init2 = await sendInitialize(server.info.baseUrl, sessionId1, {
        elicitation: { form: {} },
        roots: { listChanged: true },
      });
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId;
      expect(sessionId2).toBeTruthy();
      if (!sessionId2) throw new Error('Expected sessionId after reconnect initialize');
      expect(sessionId2).not.toBe(sessionId1);

      // Step 5: Verify new session works
      const listResult2 = await sendToolsList(server.info.baseUrl, sessionId2);
      expect(listResult2.status).toBe(200);
    });

    test('should handle reconnect with different capabilities', async ({ server }) => {
      // Initialize without elicitation capabilities
      const init1 = await sendInitialize(server.info.baseUrl, undefined, {});
      expect(init1.status).toBe(200);
      const sessionId1 = init1.sessionId;
      expect(sessionId1).toBeTruthy();
      if (!sessionId1) throw new Error('Expected sessionId after initialize');

      // Terminate
      const { status: deleteStatus } = await sendDelete(server.info.baseUrl, sessionId1);
      expect(deleteStatus).toBe(204);

      // Re-initialize with stale session ID and different (elicitation) capabilities
      const init2 = await sendInitialize(server.info.baseUrl, sessionId1, {
        elicitation: { form: {} },
      });
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId;
      expect(sessionId2).toBeTruthy();
      if (!sessionId2) throw new Error('Expected sessionId after reconnect initialize');
      expect(sessionId2).not.toBe(sessionId1);

      // Verify session works
      const listResult = await sendToolsList(server.info.baseUrl, sessionId2);
      expect(listResult.status).toBe(200);
    });
  });

  test.describe('Session ID integrity after reconnect', () => {
    test('should have consistent session ID in tool auth context after reconnect', async ({ server }) => {
      // Step 1: Initialize, get session
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sessionId1 = init1.sessionId;
      if (!sessionId1) throw new Error('Expected sessionId after initialize');

      // Send notifications/initialized with new session
      await sendNotificationInitialized(server.info.baseUrl, sessionId1);

      // Step 2: Call get-session-info — session ID in tool context should match header
      const toolResult1 = await sendToolCall(server.info.baseUrl, sessionId1, 'get-session-info');
      expect(toolResult1.status).toBe(200);
      const body1 = toolResult1.body as Record<string, unknown>;
      const result1 = body1['result'] as Record<string, unknown>;
      const content1 = result1['content'] as Array<{ text: string }>;
      const info1 = JSON.parse(content1[0].text) as { sessionId: string };
      expect(info1.sessionId).not.toContain('fallback');

      // Step 3: DELETE and reconnect with stale session ID
      await sendDelete(server.info.baseUrl, sessionId1);
      const init2 = await sendInitialize(server.info.baseUrl, sessionId1);
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId;
      if (!sessionId2) throw new Error('Expected sessionId after reconnect');
      expect(sessionId2).not.toBe(sessionId1);

      // Send notifications/initialized with NEW session
      await sendNotificationInitialized(server.info.baseUrl, sessionId2);

      // Step 4: Call get-session-info with new session — should have real session ID, not fallback
      const toolResult2 = await sendToolCall(server.info.baseUrl, sessionId2, 'get-session-info');
      expect(toolResult2.status).toBe(200);
      const body2 = toolResult2.body as Record<string, unknown>;
      const result2 = body2['result'] as Record<string, unknown>;
      const content2 = result2['content'] as Array<{ text: string }>;
      const info2 = JSON.parse(content2[0].text) as { sessionId: string; hasSession: boolean };

      // CRITICAL: The session ID in the tool's auth context must NOT be a fallback
      expect(info2.sessionId).not.toContain('fallback');
      expect(info2.hasSession).toBe(true);
      // Session ID should differ from the old session
      expect(info2.sessionId).not.toBe(info1.sessionId);
    });

    test('full reconnect protocol handshake should work end-to-end', async ({ server }) => {
      // Step 1: Full initial handshake
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const sessionId1 = init1.sessionId;
      if (!sessionId1) throw new Error('Expected sessionId');

      const notif1 = await sendNotificationInitialized(server.info.baseUrl, sessionId1);
      expect(notif1.status).toBe(202);

      // Step 2: Verify tools work
      const list1 = await sendToolsList(server.info.baseUrl, sessionId1);
      expect(list1.status).toBe(200);

      const tool1 = await sendToolCall(server.info.baseUrl, sessionId1, 'increment-counter', { amount: 5 });
      expect(tool1.status).toBe(200);

      // Step 3: DELETE
      const del = await sendDelete(server.info.baseUrl, sessionId1);
      expect(del.status).toBe(204);

      // Step 4: Full reconnect handshake with stale session
      const init2 = await sendInitialize(server.info.baseUrl, sessionId1);
      expect(init2.status).toBe(200);
      const sessionId2 = init2.sessionId;
      if (!sessionId2) throw new Error('Expected sessionId after reconnect');

      const notif2 = await sendNotificationInitialized(server.info.baseUrl, sessionId2);
      expect(notif2.status).toBe(202);

      // Step 5: Verify new session works with tools
      const list2 = await sendToolsList(server.info.baseUrl, sessionId2);
      expect(list2.status).toBe(200);

      const tool2 = await sendToolCall(server.info.baseUrl, sessionId2, 'increment-counter', { amount: 1 });
      expect(tool2.status).toBe(200);
      const body2 = tool2.body as Record<string, unknown>;
      const result2 = body2['result'] as Record<string, unknown>;
      const content2 = result2['content'] as Array<{ text: string }>;
      const toolOutput = JSON.parse(content2[0].text) as { previousValue: number };
      // Counter should start fresh (previous value = 0)
      expect(toolOutput.previousValue).toBe(0);
    });
  });

  test.describe('Transport cleanup on DELETE', () => {
    test('should reject tool calls with terminated session', async ({ server }) => {
      // Initialize and verify
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.status).toBe(200);
      const sessionId = init.sessionId;
      if (!sessionId) throw new Error('Expected sessionId');

      await sendNotificationInitialized(server.info.baseUrl, sessionId);

      const tool1 = await sendToolCall(server.info.baseUrl, sessionId, 'get-session-info');
      expect(tool1.status).toBe(200);

      // DELETE
      const del = await sendDelete(server.info.baseUrl, sessionId);
      expect(del.status).toBe(204);

      // Tool call with terminated session should fail with 404
      const tool2 = await sendToolCall(server.info.baseUrl, sessionId, 'get-session-info');
      expect(tool2.status).toBe(404);
    });

    test('should not contaminate other active sessions on DELETE', async ({ server }) => {
      // Client A: Initialize and store data
      const initA = await sendInitialize(server.info.baseUrl);
      expect(initA.status).toBe(200);
      const sessionA = initA.sessionId;
      if (!sessionA) throw new Error('Expected sessionId A');
      await sendNotificationInitialized(server.info.baseUrl, sessionA);

      await sendToolCall(server.info.baseUrl, sessionA, 'increment-counter', { amount: 10 });

      // Client B: Initialize and store data
      const initB = await sendInitialize(server.info.baseUrl);
      expect(initB.status).toBe(200);
      const sessionB = initB.sessionId;
      if (!sessionB) throw new Error('Expected sessionId B');
      await sendNotificationInitialized(server.info.baseUrl, sessionB);

      await sendToolCall(server.info.baseUrl, sessionB, 'increment-counter', { amount: 20 });

      // Client A: DELETE session
      const del = await sendDelete(server.info.baseUrl, sessionA);
      expect(del.status).toBe(204);

      // Client B should still work fine
      const toolB = await sendToolCall(server.info.baseUrl, sessionB, 'get-session-info');
      expect(toolB.status).toBe(200);
      const bodyB = toolB.body as Record<string, unknown>;
      const resultB = bodyB['result'] as Record<string, unknown>;
      const contentB = resultB['content'] as Array<{ text: string }>;
      const infoB = JSON.parse(contentB[0].text) as { hasSession: boolean };
      expect(infoB.hasSession).toBe(true);

      // Client A reconnect should work independently
      const initA2 = await sendInitialize(server.info.baseUrl);
      expect(initA2.status).toBe(200);
      const sessionA2 = initA2.sessionId;
      if (!sessionA2) throw new Error('Expected sessionId A2');
      expect(sessionA2).not.toBe(sessionA);
      expect(sessionA2).not.toBe(sessionB);
    });
  });

  test.describe('Fabricated session ID (never existed)', () => {
    test('should return 404 for tools/list with fabricated session ID', async ({ server }) => {
      const { status } = await sendToolsList(server.info.baseUrl, 'completely-fabricated-session-id-12345');
      expect(status).toBe(404);
    });

    test('should return 404 for tools/call with fabricated session ID', async ({ server }) => {
      const result = await sendToolCall(server.info.baseUrl, 'random-nonexistent-session', 'get-session-info');
      expect(result.status).toBe(404);
    });

    test('should return 404 for notifications/initialized with fabricated session ID', async ({ server }) => {
      const { status } = await sendNotificationInitialized(server.info.baseUrl, 'fake-session-never-created');
      expect(status).toBe(404);
    });
  });

  test.describe('Invalid session header format', () => {
    test('should reject session ID exceeding 2048 chars with error status', async ({ server }) => {
      const longId = 'a'.repeat(2049);
      const result = await sendRawPost(
        server.info.baseUrl,
        {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': longId,
        },
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      );
      // Server rejects oversized session IDs — may be 404 (schema validation)
      // or 500 (upstream header size limit). Either way, not 200.
      expect(result.status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Response Mcp-Session-Id header consistency', () => {
    test('should include mcp-session-id in initialize response', async ({ server }) => {
      const result = await sendInitialize(server.info.baseUrl);
      expect(result.status).toBe(200);
      expect(result.sessionId).toBeTruthy();
    });

    test('should include matching mcp-session-id in tools/list response', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      expect(init.sessionId).toBeTruthy();
      if (!init.sessionId) throw new Error('Expected sessionId');

      await sendNotificationInitialized(server.info.baseUrl, init.sessionId);

      const list = await sendToolsList(server.info.baseUrl, init.sessionId);
      expect(list.status).toBe(200);
      expect(list.responseSessionId).toBe(init.sessionId);
    });

    test('should include matching mcp-session-id in tools/call response', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      if (!init.sessionId) throw new Error('Expected sessionId');

      await sendNotificationInitialized(server.info.baseUrl, init.sessionId);

      const call = await sendToolCall(server.info.baseUrl, init.sessionId, 'get-session-info');
      expect(call.status).toBe(200);
      expect(call.sessionId).toBe(init.sessionId);
    });
  });

  test.describe('Multiple rapid reconnects', () => {
    test('should handle DELETE -> init -> DELETE -> init in quick succession', async ({ server }) => {
      // Cycle 1: init
      const init1 = await sendInitialize(server.info.baseUrl);
      expect(init1.status).toBe(200);
      const s1 = init1.sessionId;
      if (!s1) throw new Error('Expected s1');

      // Cycle 1: delete
      const del1 = await sendDelete(server.info.baseUrl, s1);
      expect(del1.status).toBe(204);

      // Cycle 2: init (clean)
      const init2 = await sendInitialize(server.info.baseUrl);
      expect(init2.status).toBe(200);
      const s2 = init2.sessionId;
      if (!s2) throw new Error('Expected s2');
      expect(s2).not.toBe(s1);

      // Cycle 2: delete
      const del2 = await sendDelete(server.info.baseUrl, s2);
      expect(del2.status).toBe(204);

      // Cycle 3: init (clean)
      const init3 = await sendInitialize(server.info.baseUrl);
      expect(init3.status).toBe(200);
      const s3 = init3.sessionId;
      if (!s3) throw new Error('Expected s3');
      expect(s3).not.toBe(s1);
      expect(s3).not.toBe(s2);

      // Verify final session works
      await sendNotificationInitialized(server.info.baseUrl, s3);
      const tool = await sendToolCall(server.info.baseUrl, s3, 'get-session-info');
      expect(tool.status).toBe(200);
    });

    test('should handle rapid re-init with same stale session ID', async ({ server }) => {
      const init1 = await sendInitialize(server.info.baseUrl);
      const s1 = init1.sessionId;
      if (!s1) throw new Error('Expected s1');

      // DELETE and re-init with stale s1
      await sendDelete(server.info.baseUrl, s1);
      const init2 = await sendInitialize(server.info.baseUrl, s1);
      expect(init2.status).toBe(200);
      const s2 = init2.sessionId;
      if (!s2) throw new Error('Expected s2');
      expect(s2).not.toBe(s1);

      // DELETE s2 and re-init again with original s1
      await sendDelete(server.info.baseUrl, s2);
      const init3 = await sendInitialize(server.info.baseUrl, s1);
      expect(init3.status).toBe(200);
      const s3 = init3.sessionId;
      if (!s3) throw new Error('Expected s3');
      expect(s3).not.toBe(s1);
      expect(s3).not.toBe(s2);
    });
  });

  test.describe('Notifications/initialized after reconnect', () => {
    test('should accept notifications/initialized after reconnect with 202', async ({ server }) => {
      // Init, delete, reconnect
      const init1 = await sendInitialize(server.info.baseUrl);
      const s1 = init1.sessionId;
      if (!s1) throw new Error('Expected s1');

      await sendDelete(server.info.baseUrl, s1);

      const init2 = await sendInitialize(server.info.baseUrl, s1);
      const s2 = init2.sessionId;
      if (!s2) throw new Error('Expected s2');

      // Send notifications/initialized with new session
      const notif = await sendNotificationInitialized(server.info.baseUrl, s2);
      expect(notif.status).toBe(202);
    });

    test('should allow tools/call immediately after initialize (skip notifications/initialized)', async ({
      server,
    }) => {
      const init = await sendInitialize(server.info.baseUrl);
      const s = init.sessionId;
      if (!s) throw new Error('Expected session');

      // Skip notifications/initialized — go straight to tool call
      const tool = await sendToolCall(server.info.baseUrl, s, 'get-session-info');
      expect(tool.status).toBe(200);
    });
  });

  test.describe('SSE listener with stale session', () => {
    test('should return 404 for GET SSE with terminated session ID', async ({ server }) => {
      const init = await sendInitialize(server.info.baseUrl);
      const s = init.sessionId;
      if (!s) throw new Error('Expected session');

      await sendNotificationInitialized(server.info.baseUrl, s);
      await sendDelete(server.info.baseUrl, s);

      const sse = await sendSseGet(server.info.baseUrl, s);
      expect(sse.status).toBe(404);
    });

    test('should return 404 for GET SSE with fabricated session ID', async ({ server }) => {
      const sse = await sendSseGet(server.info.baseUrl, 'fabricated-sse-session');
      expect(sse.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SSE (Legacy) SESSION LIFECYCLE TESTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Send a POST to /message with sessionId query param (legacy SSE message endpoint).
 */
async function sendSseMessage(
  baseUrl: string,
  sessionId: string,
  body: unknown,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}/message?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

/**
 * Connect to legacy SSE endpoint (GET /sse) and extract session ID from the endpoint event.
 * Returns the session URL (which contains the session ID) and a close function.
 */
async function connectSse(baseUrl: string): Promise<{ endpointUrl: string; sessionId: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('SSE connection timeout (5s)'));
    }, 5000);

    fetch(`${baseUrl}/sse`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          clearTimeout(timer);
          reject(new Error(`SSE connection failed: ${response.status}`));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const read = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) return;

          buffer += decoder.decode(value, { stream: true });

          // Look for the endpoint event which contains the message URL with sessionId
          const endpointMatch = buffer.match(/event: endpoint\ndata: (.+)\n/);
          if (endpointMatch) {
            clearTimeout(timer);
            const endpointUrl = endpointMatch[1].trim();
            // Extract sessionId from the endpoint URL query params
            const url = new URL(endpointUrl, baseUrl);
            const sessionId = url.searchParams.get('sessionId') ?? '';

            resolve({
              endpointUrl,
              sessionId,
              close: () => {
                controller.abort();
              },
            });
            return;
          }

          return read();
        };

        read().catch(() => {
          /* abort expected */
        });
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name !== 'AbortError') reject(err);
      });
  });
}

test.describe('SSE Session Lifecycle E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-transport-recreation/src/main.ts',
    project: 'demo-e2e-transport-recreation',
    publicMode: true,
  });

  test.describe('SSE connection and initialization', () => {
    test('should establish SSE connection and return session ID', async ({ server }) => {
      const { sessionId, close } = await connectSse(server.info.baseUrl);
      expect(sessionId).toBeTruthy();
      expect(sessionId.length).toBeGreaterThan(0);
      close();
    });

    test('should accept initialize via /message endpoint', async ({ server }) => {
      const { sessionId, close } = await connectSse(server.info.baseUrl);

      const result = await sendSseMessage(server.info.baseUrl, sessionId, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'sse-test', version: '1.0.0' },
        },
      });

      expect(result.status).toBe(202);
      close();
    });
  });

  test.describe('Fabricated session ID on SSE', () => {
    test('should return 404 for /message with fabricated sessionId query param', async ({ server }) => {
      const result = await sendSseMessage(server.info.baseUrl, 'completely-fabricated-sse-session', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
      expect(result.status).toBe(404);
    });

    test('should return 404 for /message with mcp-session-id header and fabricated ID', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': 'fabricated-header-session',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(response.status).toBe(404);
    });
  });

  test.describe('Invalid session format on SSE', () => {
    test('should reject oversized session ID on /message', async ({ server }) => {
      const longId = 'a'.repeat(2049);
      const result = await sendSseMessage(server.info.baseUrl, longId, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
      // Either 404 (schema validation) or error status (upstream rejection)
      expect(result.status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Tools execution over SSE', () => {
    test('should execute tool via /message after SSE connection', async ({ server }) => {
      const { sessionId, close } = await connectSse(server.info.baseUrl);

      // Initialize
      const initResult = await sendSseMessage(server.info.baseUrl, sessionId, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'sse-test', version: '1.0.0' },
        },
      });
      expect(initResult.status).toBe(202);

      // Send notifications/initialized
      await sendSseMessage(server.info.baseUrl, sessionId, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      // Call tool
      const toolResult = await sendSseMessage(server.info.baseUrl, sessionId, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get-session-info', arguments: {} },
      });
      expect(toolResult.status).toBe(202);

      close();
    });
  });
});
