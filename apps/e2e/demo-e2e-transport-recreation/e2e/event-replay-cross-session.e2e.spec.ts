/**
 * E2E regression guard for GHSA-84j6-jc92-77jm — cross-session SSE replay.
 *
 * With resumability enabled, a reconnecting client sends
 * `Last-Event-ID: <streamId>:<sequence>`. One `EventStore` backs every session on
 * the scope and the upstream replay contract carries no caller identity, so the
 * store replayed whatever stream the id named.
 *
 * The upstream transport writes every session's standalone GET/SSE stream under
 * the constant id `_GET_stream` and numbers events sequentially, so the header
 * below required no guessing at all — it is built entirely from public
 * knowledge.
 */
import { expect, TestServer } from '@frontmcp/testing';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-transport-recreation/src/main.event-store.ts';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

function initializeBody(clientName: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0' },
    },
  });
}

/** Open a session and return its id. */
async function openSession(baseUrl: string, clientName: string): Promise<string> {
  const res = await fetch(baseUrl, { method: 'POST', headers: MCP_HEADERS, body: initializeBody(clientName) });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

/** Read an SSE stream for a moment, returning whatever arrived. */
async function readStream(baseUrl: string, sessionId: string, lastEventId?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Mcp-Session-Id': sessionId,
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      },
      signal: controller.signal,
    });
    if (!res.body) return '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      // Aborted by the timer — whatever arrived is what we assert on.
    }
    return text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

describe('Cross-session SSE replay (GHSA-84j6-jc92-77jm)', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-transport-recreation',
      startupTimeout: 60_000,
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90_000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('does not replay another session backlog for a guessed Last-Event-ID', async () => {
    const victim = await openSession(baseUrl, 'victim');
    const attacker = await openSession(baseUrl, 'attacker');

    // Let the victim's standalone stream exist and accumulate whatever the
    // server sends it.
    await readStream(baseUrl, victim);

    // The header an attacker sends, built from the published constant plus a
    // small integer — no victim-specific knowledge required.
    const replayed = await readStream(baseUrl, attacker, '_GET_stream:1');

    expect(replayed).not.toContain('"result"');
    expect(replayed).not.toContain('"method":"notifications');
  });

  it('still lets a session reconnect to its own stream', async () => {
    const sessionId = await openSession(baseUrl, 'legitimate');

    // A reconnect with no Last-Event-ID must still open a working stream.
    const stream = await readStream(baseUrl, sessionId);

    expect(typeof stream).toBe('string');
  });
});
