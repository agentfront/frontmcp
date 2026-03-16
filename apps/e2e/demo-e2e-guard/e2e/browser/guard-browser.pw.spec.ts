/**
 * Playwright Browser E2E Tests for Guard
 *
 * Tests that guard errors are properly returned when requests come from
 * a browser client via raw HTTP JSON-RPC calls to the MCP endpoint.
 *
 * Uses Playwright's `request` API fixture for HTTP testing (no DOM needed).
 */
import { test, expect } from '@playwright/test';

const MCP_ENDPOINT = '/mcp';

/**
 * Initialize an MCP session and return the session ID from the response header.
 */
async function initializeSession(request: ReturnType<typeof test.extend>['request'] extends infer R ? R : never) {
  const response = await (request as { post: Function }).post(MCP_ENDPOINT, {
    data: {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'playwright-test', version: '1.0.0' },
      },
    },
    headers: { 'Content-Type': 'application/json' },
  });

  const sessionId = response.headers()['mcp-session-id'];
  return { response, sessionId };
}

/**
 * Call a tool via raw JSON-RPC POST.
 */
async function callTool(
  request: unknown,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  id: string | number = 'call-1',
) {
  return (request as { post: Function }).post(MCP_ENDPOINT, {
    data: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    },
    headers: {
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId,
    },
  });
}

test.describe('Guard Browser E2E', () => {
  test('should call tool successfully via browser HTTP', async ({ request }) => {
    const { sessionId } = await initializeSession(request);
    expect(sessionId).toBeTruthy();

    const response = await callTool(request, sessionId, 'unguarded', { value: 'browser-test' });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.isError).not.toBe(true);
  });

  test('should receive rate limit error after exceeding limit', async ({ request }) => {
    const { sessionId } = await initializeSession(request);

    // Send 3 requests (within limit)
    for (let i = 0; i < 3; i++) {
      const response = await callTool(request, sessionId, 'rate-limited', { message: `req-${i}` }, `call-${i}`);
      expect(response.status()).toBe(200);
    }

    // 4th request should trigger rate limit
    const response = await callTool(request, sessionId, 'rate-limited', { message: 'over-limit' }, 'call-blocked');
    const body = await response.json();

    // Rate limit errors surface as isError: true in the tool result
    expect(body.result?.isError).toBe(true);
  });

  test('should receive timeout error for slow execution', async ({ request }) => {
    const { sessionId } = await initializeSession(request);

    // timeout-tool has 500ms timeout, 1000ms delay exceeds it
    const response = await callTool(request, sessionId, 'timeout-tool', { delayMs: 1000 }, 'call-timeout');
    const body = await response.json();

    expect(body.result?.isError).toBe(true);
    const content = JSON.stringify(body.result?.content ?? []);
    expect(content.toLowerCase()).toMatch(/timeout|timed.out/i);
  });

  test('should call multiple tools and maintain rate limit state via HTTP', async ({ request }) => {
    const { sessionId } = await initializeSession(request);

    // Call rate-limited tool 3 times (within limit)
    for (let i = 0; i < 3; i++) {
      const response = await callTool(request, sessionId, 'rate-limited', { message: `req-${i}` }, `call-${i}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.result?.isError).not.toBe(true);
    }

    // 4th call should hit the per-tool rate limit
    const response = await callTool(request, sessionId, 'rate-limited', { message: 'over' }, 'call-blocked');
    expect(response.status()).toBe(200); // MCP returns 200 with error in body
    const body = await response.json();
    expect(body.result?.isError).toBe(true);
  });
});
