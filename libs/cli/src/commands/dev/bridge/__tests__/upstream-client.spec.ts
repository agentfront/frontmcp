/**
 * Upstream clients of the dev bridge (#679).
 *
 * HTTP mode pinned a session id of its own that the server never issued, so the
 * request after `initialize` answered 404 → `dev_server_unreachable`. The
 * client now uses the id the server issues, and replays the client's handshake
 * on a restarted child.
 */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { BridgeLogger } from '../log';
import type { JsonRpcFrame } from '../stdio-framer';
import { createHttpUpstream, createPipeUpstream } from '../upstream-client';

function silentLog(): BridgeLogger {
  return {
    path: undefined,
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    reloadEvent: jest.fn(),
    close: async () => undefined,
  };
}

interface Seen {
  method?: string;
  sessionId?: string;
}

/** A minimal streamable-HTTP MCP endpoint that, like the SDK, only knows sessions it issued. */
async function startServer(options: { sse?: boolean } = {}): Promise<{
  url: string;
  seen: Seen[];
  close: () => Promise<void>;
}> {
  const seen: Seen[] = [];
  let issued = 0;
  const known = new Set<string>();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const frame = JSON.parse(body) as JsonRpcFrame;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      seen.push({ method: frame.method, sessionId });
      if (frame.method === 'initialize') {
        const id = `session-${++issued}`;
        known.add(id);
        res.setHeader('mcp-session-id', id);
        const reply = { jsonrpc: '2.0', id: frame.id, result: { capabilities: { tools: { listChanged: true } } } };
        if (options.sse) {
          res.setHeader('content-type', 'text/event-stream');
          res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
        } else {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(reply));
        }
        return;
      }
      if (!sessionId || !known.has(sessionId)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (frame.id === undefined) {
        res.statusCode = 202;
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { ok: true, sessionId } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const initialize: JsonRpcFrame = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '0' } },
};

describe('createHttpUpstream', () => {
  it('uses the session id the server issued on initialize for every later request', async () => {
    const server = await startServer();
    const frames: JsonRpcFrame[] = [];
    try {
      const upstream = createHttpUpstream({ url: server.url, log: silentLog(), onFrame: (f) => void frames.push(f) });
      await upstream.send(initialize);
      await upstream.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await upstream.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } });

      expect(server.seen.map((s) => s.sessionId)).toEqual([undefined, 'session-1', 'session-1']);
      // The 202 for the notification carries no frame.
      expect(frames.map((f) => f.id)).toEqual([1, 2]);
      expect(frames[1].result).toEqual({ ok: true, sessionId: 'session-1' });
    } finally {
      await server.close();
    }
  });

  it('reads responses streamed as SSE', async () => {
    const server = await startServer({ sse: true });
    const frames: JsonRpcFrame[] = [];
    try {
      const upstream = createHttpUpstream({ url: server.url, log: silentLog(), onFrame: (f) => void frames.push(f) });
      await upstream.send(initialize);
      expect(frames).toHaveLength(1);
      expect(frames[0].id).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('replays the handshake on a fresh child without relaying its response', async () => {
    const server = await startServer();
    const frames: JsonRpcFrame[] = [];
    try {
      const upstream = createHttpUpstream({ url: server.url, log: silentLog(), onFrame: (f) => void frames.push(f) });
      const result = await upstream.reinitialize(initialize, true);
      await upstream.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });

      expect(result).toEqual({ capabilities: { tools: { listChanged: true } } });
      expect(server.seen.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
      expect(server.seen[2].sessionId).toBe('session-1');
      expect(frames.map((f) => f.id)).toEqual([7]);
    } finally {
      await server.close();
    }
  });

  it('skips notifications/initialized when the client never sent it', async () => {
    const server = await startServer();
    try {
      const upstream = createHttpUpstream({ url: server.url, log: silentLog(), onFrame: () => undefined });
      await upstream.reinitialize(initialize, false);
      expect(server.seen.map((s) => s.method)).toEqual(['initialize']);
    } finally {
      await server.close();
    }
  });

  it('rejects a non-OK response so the bridge answers the client', async () => {
    const server = await startServer();
    try {
      const upstream = createHttpUpstream({ url: server.url, log: silentLog(), onFrame: () => undefined });
      await expect(upstream.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).rejects.toThrow(
        'upstream returned 404 for tools/list',
      );
    } finally {
      await server.close();
    }
  });
});

class FakeIpcChild extends EventEmitter {
  connected = true;
  sent: JsonRpcFrame[] = [];
  /** Answers every request it is sent. */
  respond: (frame: JsonRpcFrame) => unknown = (frame) => ({
    jsonrpc: '2.0',
    id: frame.id,
    result: { echo: frame.method },
  });

  send(frame: JsonRpcFrame, callback: (err: Error | null) => void): boolean {
    this.sent.push(frame);
    callback(null);
    if (frame.id !== undefined) setImmediate(() => this.emit('message', this.respond(frame)));
    return true;
  }
}

describe('createPipeUpstream', () => {
  it('forwards frames and relays responses, ignoring SDK control messages', async () => {
    const child = new FakeIpcChild();
    const frames: JsonRpcFrame[] = [];
    const upstream = createPipeUpstream({
      child: child as unknown as ChildProcess,
      log: silentLog(),
      onFrame: (f) => void frames.push(f),
    });
    child.emit('message', { __frontmcp: 'ready' });
    await upstream.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(frames).toEqual([{ jsonrpc: '2.0', id: 1, result: { echo: 'tools/list' } }]);
    await upstream.close();
  });

  it('replays the handshake and keeps its response from the client', async () => {
    const child = new FakeIpcChild();
    const frames: JsonRpcFrame[] = [];
    const upstream = createPipeUpstream({
      child: child as unknown as ChildProcess,
      log: silentLog(),
      onFrame: (f) => void frames.push(f),
    });

    const result = await upstream.reinitialize(initialize, true);

    expect(result).toEqual({ echo: 'initialize' });
    expect(child.sent.map((f) => f.method)).toEqual(['initialize', 'notifications/initialized']);
    expect(String(child.sent[0].id)).toMatch(/^frontmcp-dev-bridge:reinitialize:/);
    expect(frames).toEqual([]);
  });

  it('surfaces an error answer to the replayed initialize', async () => {
    const child = new FakeIpcChild();
    child.respond = (frame) => ({ jsonrpc: '2.0', id: frame.id, error: { code: -32600, message: 'nope' } });
    const upstream = createPipeUpstream({
      child: child as unknown as ChildProcess,
      log: silentLog(),
      onFrame: jest.fn(),
    });

    await expect(upstream.reinitialize(initialize, true)).rejects.toThrow('replayed initialize failed: nope');
  });

  it('times out when the child never answers the replayed initialize', async () => {
    const child = new FakeIpcChild();
    child.send = (frame, callback) => {
      child.sent.push(frame);
      callback(null);
      return true;
    };
    const upstream = createPipeUpstream({
      child: child as unknown as ChildProcess,
      log: silentLog(),
      onFrame: jest.fn(),
      reinitializeTimeoutMs: 20,
    });

    await expect(upstream.reinitialize(initialize, false)).rejects.toThrow(/no response to the replayed initialize/);
  });

  it('rejects sends once the IPC channel is gone', async () => {
    const child = new FakeIpcChild();
    child.connected = false;
    const upstream = createPipeUpstream({
      child: child as unknown as ChildProcess,
      log: silentLog(),
      onFrame: jest.fn(),
    });

    await expect(upstream.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).rejects.toThrow(
      'pipe upstream disconnected for tools/list',
    );
  });
});
