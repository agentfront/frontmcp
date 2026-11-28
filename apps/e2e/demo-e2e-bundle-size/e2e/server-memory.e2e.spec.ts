/**
 * The memory a one-tool server holds once it has answered its first `tools/call` (#948): its live heap after a full
 * GC, and the new space V8 committed. A change that loads more code or builds more at startup fails here before it
 * reaches a release.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { resolve } from 'node:path';

import { workspaceRoot } from './helpers/browser-bundle';

// 35.6 MB on 1.14 with the MCP SDK v2 (34.3 MB on 1.13 with v1), plus 2 MB of headroom
const LIVE_HEAP_MAX_BYTES = 37_600_000;
// 32 MiB: still twice the official SDK's 16 MiB (#948), but another doubling fails
const NEW_SPACE_MAX_BYTES = 33_554_432;

interface Measurement {
  liveHeap: number;
  newSpace: number;
  rss: number;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolveOpen) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolveOpen(true);
    });
    socket.once('error', () => resolveOpen(false));
  });
}

async function post(port: number, body: unknown, sessionId?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('a one-tool server after its first tools/call', () => {
  let server: ChildProcess | undefined;

  afterEach(() => {
    server?.kill('SIGKILL');
  });

  it('keeps its live heap and new space within their budgets', async () => {
    const port = await freePort();
    server = fork(
      resolve(__dirname, 'helpers', 'one-tool-server.cjs'),
      [resolve(workspaceRoot, 'libs/sdk/dist/index.js'), String(port)],
      {
        execArgv: ['--expose-gc'],
        env: { ...process.env, NODE_ENV: 'production', MCP_SESSION_SECRET: 'a'.repeat(64) },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      },
    );
    const deadline = Date.now() + 30_000;
    while (!(await accepts(port))) {
      if (Date.now() > deadline) throw new Error('the server never listened');
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }

    const initialize = await post(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'memory', version: '1' } },
    });
    const sessionId = initialize.headers.get('mcp-session-id');
    await initialize.text();
    await (await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)).text();
    const call = await post(
      port,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add', arguments: { a: 2, b: 3 } } },
      sessionId,
    );
    expect(await call.text()).toContain('5');
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));

    const measured = await new Promise<Measurement>((resolveMeasure) => {
      server?.once('message', (message) => resolveMeasure(message as Measurement));
      server?.send('measure');
    });
    process.stdout.write(
      `one-tool server after its first tools/call: live heap ${measured.liveHeap.toLocaleString('en-US')} bytes ` +
        `(budget ${LIVE_HEAP_MAX_BYTES.toLocaleString('en-US')}), new space ${measured.newSpace.toLocaleString('en-US')} ` +
        `(budget ${NEW_SPACE_MAX_BYTES.toLocaleString('en-US')}), RSS ${measured.rss.toLocaleString('en-US')}\n`,
    );
    expect(measured.liveHeap).toBeLessThanOrEqual(LIVE_HEAP_MAX_BYTES);
    expect(measured.newSpace).toBeLessThanOrEqual(NEW_SPACE_MAX_BYTES);
  });
});
