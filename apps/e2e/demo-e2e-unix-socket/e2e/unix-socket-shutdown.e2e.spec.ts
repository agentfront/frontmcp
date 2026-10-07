/**
 * E2E: a server on a Unix socket (`FRONTMCP_DAEMON_SOCKET`, as a daemon runs) shuts down gracefully on
 * SIGTERM, as the TCP server does: a call in flight gets its whole reply, then the process exits 0 and
 * the socket file is gone. It used to remove the socket and exit at once, so the call got an empty reply.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { httpOverSocket, UnixSocketMcpClient } from './helpers/unix-socket-client';

const serverScript = path.join(__dirname, 'fixtures', 'daemon-socket-server.cjs');

async function waitForHealth(socketPath: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await httpOverSocket(socketPath, { path: '/health' })).statusCode === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server not ready within ${timeoutMs}ms: ${socketPath}`);
}

describe('Unix socket graceful shutdown', () => {
  let server: ChildProcess | undefined;

  afterEach(() => {
    if (server?.exitCode === null) server.kill('SIGKILL');
  });

  it('lets a call in flight finish on SIGTERM, then exits 0 and removes the socket', async () => {
    const socketPath = path.join(os.tmpdir(), `mcp-${randomUUID().slice(0, 8)}.sock`);
    server = spawn(process.execPath, [serverScript], {
      env: { ...process.env, FRONTMCP_DAEMON_SOCKET: socketPath, NODE_ENV: 'test', SLOW_TOOL_MS: '1000' },
      stdio: 'ignore',
    });
    const exited = new Promise<number | null>((resolve) => server?.once('exit', (code) => resolve(code)));
    await waitForHealth(socketPath);

    const client = new UnixSocketMcpClient(socketPath);
    await client.initialize();
    const inFlight = client.request('tools/call', { name: 'slow', arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 300));
    server.kill('SIGTERM');

    const reply = await inFlight;
    expect(JSON.stringify(reply.result)).toContain('finished');
    expect(await exited).toBe(0);
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});
