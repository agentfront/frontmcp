/**
 * E2E regression guard for GHSA-84j6-jc92-77jm — cross-session SSE replay.
 *
 * With resumability enabled, a reconnecting client sends
 * `Last-Event-ID: <streamId>:<sequence>`. One `EventStore` backs every session on
 * the scope and the upstream replay contract carries no caller identity, so the
 * store replayed whatever stream that id named.
 *
 * Two ids are tried here, and both are things an attacker can actually obtain:
 *
 *  1. A REAL, server-minted event id captured from another session's own
 *     response stream — the strongest case, since nothing about it is guessed.
 *  2. `_GET_stream:1` — the upstream transport writes every session's standalone
 *     stream under that hardcoded constant and numbers events sequentially, so
 *     this header is built from public knowledge alone.
 *
 * `readStream` reports the HTTP status and throws on a transport error rather
 * than turning failures into an empty body. Without that, every "the other
 * session's data did not arrive" assertion below would pass just as happily when
 * the stream never opened at all.
 *
 * Because the stores now implement the optional `getStreamIdForEventId`, the
 * upstream transport's dormant guard is live again: a `Last-Event-ID` it cannot
 * resolve is REFUSED with 400 rather than silently replaying nothing. That is
 * the stronger outcome, and it is what these tests pin.
 */
import * as http from 'node:http';

import { expect, TestServer } from '@frontmcp/testing';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-transport-recreation/src/main.event-store.ts';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

let rpcId = 0;
const rpc = (method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) });

/** Open a session and return its id. */
async function openSession(baseUrl: string, clientName: string): Promise<string> {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0' },
    }),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();

  await fetch(baseUrl, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sessionId! },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return sessionId!;
}

/**
 * Run a tool and return a REAL event id the server minted for that session,
 * plus the marker text carried in the response.
 *
 * The response rides an SSE-framed stream whose frames carry `id:` lines, so
 * this yields a genuine, in-store event id belonging to this session — exactly
 * what an attacker would try to reuse.
 */
async function captureOwnEventId(baseUrl: string, sessionId: string): Promise<{ eventId: string; body: string }> {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sessionId },
    body: rpc('tools/call', { name: 'get-session-info', arguments: {} }),
  });
  expect(res.status).toBe(200);

  const body = await res.text();
  const eventId = body.match(/^id:\s*(.+)$/m)?.[1]?.trim();
  expect(eventId).toBeTruthy();
  return { eventId: eventId!, body };
}

interface SseFrames {
  status: number;
  raw: string;
  eventIds: string[];
}

/**
 * Read an SSE stream briefly and return its status plus whatever arrived.
 *
 * A request or read error THROWS; a non-200 is REPORTED so the caller asserts on
 * it explicitly. Collapsing either into an empty body would make the isolation
 * assertions pass for the wrong reason.
 */
async function readStream(baseUrl: string, sessionId: string, lastEventId?: string): Promise<SseFrames> {
  const url = new URL(baseUrl);

  return new Promise<SseFrames>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionId,
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (raw += chunk));
        res.on('error', reject);

        const done = (): void => {
          res.destroy();
          resolve({ status, raw, eventIds: [...raw.matchAll(/^id:\s*(.+)$/gm)].map((m) => m[1].trim()) });
        };

        // A refused stream ends immediately; a live one is sampled briefly.
        if (status !== 200) {
          res.on('end', done);
          return;
        }
        const timer = setTimeout(done, 1500);
        timer.unref();
      },
    );

    req.on('error', reject);
    req.end();
  });
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

  it('mints event ids scoped to the owning session', async () => {
    // The mechanism the isolation below rests on: an id carries its session, so
    // one session's id cannot name another's stream.
    const a = await openSession(baseUrl, 'session-a');
    const b = await openSession(baseUrl, 'session-b');

    const { eventId: idA } = await captureOwnEventId(baseUrl, a);
    const { eventId: idB } = await captureOwnEventId(baseUrl, b);

    expect(idA).toContain(a);
    expect(idB).toContain(b);
    expect(idA).not.toContain(b);
  });

  it('replays nothing when a session presents another session real event id', async () => {
    const victim = await openSession(baseUrl, 'victim');
    const { eventId: borrowed, body } = await captureOwnEventId(baseUrl, victim);
    // Something identifiable actually went through the victim's stream.
    expect(body).toContain('"result"');

    const attacker = await openSession(baseUrl, 'attacker');
    const replayed = await readStream(baseUrl, attacker, borrowed);

    // Refused outright: the store cannot resolve an id that is not this
    // session's, so the transport rejects the resume instead of replaying.
    expect(replayed.status).toBe(400);
    expect(replayed.raw).not.toContain('"result"');
    expect(replayed.eventIds.filter((id) => id.includes(victim))).toEqual([]);
  });

  it('replays nothing for the publicly-guessable event id', async () => {
    const victim = await openSession(baseUrl, 'victim-2');
    await captureOwnEventId(baseUrl, victim);

    const attacker = await openSession(baseUrl, 'attacker-2');
    const replayed = await readStream(baseUrl, attacker, '_GET_stream:1');

    expect(replayed.status).toBe(400);
    expect(replayed.raw).not.toContain('"result"');
    expect(replayed.eventIds.filter((id) => id.includes(victim))).toEqual([]);
  });

  it('still opens a stream for a session reconnecting with its OWN event id', async () => {
    // The negative assertions above must not be passing because reconnects are
    // broken for everyone.
    const sessionId = await openSession(baseUrl, 'owner');
    const { eventId } = await captureOwnEventId(baseUrl, sessionId);

    const own = await readStream(baseUrl, sessionId, eventId);

    expect(own.status).toBe(200);
  });
});
