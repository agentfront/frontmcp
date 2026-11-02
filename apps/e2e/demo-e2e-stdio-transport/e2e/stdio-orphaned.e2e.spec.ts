/**
 * E2E: a stdio server whose client goes away shuts down through its shutdown phase and exits, instead of staying
 * alive as an orphan: when stdin closes, and when the parent dies while stdin stays open. The server's provider keeps
 * a timer running until `onShutdown()`, so only the shutdown phase lets it end.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { StdioJsonRpcProcess } from './helpers/stdio-json-rpc';

const projectPath = path.join(__dirname, '..');
const EXIT_BOUND_MS = 10_000;

const initialize = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'orphan-e2e', version: '1.0' } },
};

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function poll<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function readPids(pidFile: string): { server: number; relay: number } | undefined {
  try {
    const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as { server?: number; relay?: number };
    return pids.server && pids.relay ? { server: pids.server, relay: pids.relay } : undefined;
  } catch {
    return undefined;
  }
}

describe('stdio server without its client', () => {
  let directory: string;
  let shutdownMarker: string;
  let server: StdioJsonRpcProcess | undefined;
  const leftovers: number[] = [];

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stdio-orphan-'));
    shutdownMarker = path.join(directory, 'shutdown');
  });

  afterEach(async () => {
    for (const pid of leftovers.splice(0)) if (running(pid)) process.kill(pid, 'SIGKILL');
    await server?.stop();
    server = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('runs the shutdown phase and exits 0 when stdin closes', async () => {
    server = StdioJsonRpcProcess.start('src/stdio-orphan-entrypoint.ts', projectPath, {
      SHUTDOWN_MARKER: shutdownMarker,
    });
    expect((await server.request(initialize)).result).toBeDefined();

    const exitCode = await Promise.race([
      server.closeStdin(),
      new Promise<string>((resolve) => setTimeout(() => resolve('still running'), EXIT_BOUND_MS)),
    ]);

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(shutdownMarker, 'utf8')).toBe('shutdown');
  }, 60_000);

  it('answers a request still in flight when stdin closes, then runs the shutdown phase and exits 0', async () => {
    server = StdioJsonRpcProcess.start('src/stdio-orphan-entrypoint.ts', projectPath, {
      SHUTDOWN_MARKER: shutdownMarker,
    });
    expect((await server.request(initialize)).result).toBeDefined();
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    server.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'slow-echo', arguments: { text: 'still owed', ms: 500 } },
    });

    const exitCode = await Promise.race([
      server.closeStdin(),
      new Promise<string>((resolve) => setTimeout(() => resolve('still running'), EXIT_BOUND_MS)),
    ]);
    const reply = await server.waitFor((message) => message.id === 2);

    expect(exitCode).toBe(0);
    expect(reply.result?.['structuredContent']).toEqual({ echo: 'still owed' });
    expect(fs.readFileSync(shutdownMarker, 'utf8')).toBe('shutdown');
  }, 60_000);

  it('runs the shutdown phase and exits within a bounded time when its parent dies and stdin stays open', async () => {
    const pidFile = path.join(directory, 'pids.json');
    server = StdioJsonRpcProcess.start('src/stdio-orphan-parent.ts', projectPath, {
      SHUTDOWN_MARKER: shutdownMarker,
      SERVER_PID_FILE: pidFile,
    });
    expect((await server.request(initialize)).result).toBeDefined();
    const pids = await poll(() => readPids(pidFile), 10_000);
    if (!pids) throw new Error('the parent never reported the server pid');
    leftovers.push(pids.server, pids.relay);

    await server.kill();
    const gone = await poll(() => (running(pids.server) ? undefined : true), EXIT_BOUND_MS);

    expect(gone).toBe(true);
    expect(running(pids.relay)).toBe(true);
    expect(fs.readFileSync(shutdownMarker, 'utf8')).toBe('shutdown');
  }, 60_000);
});
