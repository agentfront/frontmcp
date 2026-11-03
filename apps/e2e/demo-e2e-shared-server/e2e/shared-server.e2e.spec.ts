/**
 * E2E: stdio sessions of one key share one local server process, started by whichever session finds none. A process
 * that takes the port of a server that stopped never receives a request or the token, neither from a session still
 * attached, which reaches a server of its own instead, nor from a new one, which attaches to that server.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';

import { deriveSharedServerKeys } from '@frontmcp/auth';

import {
  ATTACH_TIMEOUT_MS,
  callServerPid,
  initialize,
  running,
  serverPidOf,
  SharedSessions,
  waitUntil,
} from './helpers/shared-sessions';

const IDENTIFY_PATH = '/.well-known/frontmcp-shared-server';

describe('a shared local server', () => {
  let shared: SharedSessions;

  beforeEach(() => {
    shared = new SharedSessions();
  });

  afterEach(async () => {
    await shared.cleanup();
  });

  it.each(['unix', 'http'] as const)(
    'serves two stdio sessions started together from one server process (%s)',
    async (transport) => {
      const first = shared.start(transport);
      const second = shared.start(transport);

      const [firstServer, secondServer] = await Promise.all([serverPidOf(first), serverPidOf(second)]);

      expect(firstServer).toBe(secondServer);
      expect([first.pid, second.pid]).not.toContain(firstServer);
      const record = shared.readRecord();
      expect(record).toMatchObject({ transport, pid: firstServer });
      expect(fs.statSync(shared.keyDirectory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(shared.recordFile).mode & 0o777).toBe(0o600);
      if (transport === 'unix') expect(fs.statSync(shared.socketPath).mode & 0o777).toBe(0o600);

      expect(await first.closeStdin()).toBe(0);
      expect(await callServerPid(second, 3)).toBe(firstServer);

      const { token } = deriveSharedServerKeys(record.secret);
      const written = shared.logs();
      expect(written).toContain('shared-e2e');
      expect(written).not.toContain(token);
      expect(written).not.toContain(record.secret);
    },
    240_000,
  );

  it('keeps one server when the session that started it dies while the server is slow to start', async () => {
    const slow = { SHARED_BOOT_DELAY_MS: '14000' };
    const first = shared.start('http', slow);
    await waitUntil(() => shared.startedServers().length > 0, 30_000, 'the first session to start a server');
    const [starting] = shared.startedServers();
    await first.kill();
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    expect(fs.existsSync(shared.recordFile)).toBe(false);

    const second = shared.start('http', slow);

    expect(await serverPidOf(second)).toBe(starting);
    expect(shared.startedServers()).toEqual([starting]);
  }, 240_000);

  it('refuses to serve an app with auth of its own, which its token would not guard, in its own process too', async () => {
    const session = shared.start('http', { SHARED_PUBLIC_APP: '1' });

    const answer = await session.request(initialize(1), ATTACH_TIMEOUT_MS);

    expect(answer.error).toMatchObject({
      message: 'dev_reload_deadline',
      data: {
        error:
          'The shared server "e2e" did not start: app "public" has auth of its own (mode public), which the shared ' +
          "server's token would not guard; remove auth from its @App, or serve it without runShared()",
      },
    });
    expect(fs.existsSync(shared.recordFile)).toBe(false);
  }, 240_000);

  it('never sends a request or the token to a squatter on the endpoint of a server that stopped', async () => {
    const first = shared.start('http');
    const firstServer = await serverPidOf(first);
    const record = shared.readRecord();
    const { token } = deriveSharedServerKeys(record.secret);
    process.kill(firstServer, 'SIGKILL');
    await waitUntil(() => !running(firstServer), 10_000, 'the first server to die');

    const seen: Array<{ path: string; headers: http.IncomingHttpHeaders; body: string }> = [];
    const squatter = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ path: req.url ?? '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === IDENTIFY_PATH) res.end(JSON.stringify({ proof: 'A'.repeat(43) }));
        else res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      squatter.once('error', reject);
      squatter.listen(record.port, '127.0.0.1', () => resolve());
    });
    try {
      const nextServer = await callServerPid(first, 3);
      expect(nextServer).not.toBe(firstServer);

      const second = shared.start('http');
      const secondServer = await serverPidOf(second);

      expect(secondServer).toBe(nextServer);
      expect(shared.readRecord().port).not.toBe(record.port);
      expect(seen.length).toBeGreaterThan(0);
      for (const request of seen) {
        expect(request.path).toBe(IDENTIFY_PATH);
        expect(request.headers['authorization']).toBeUndefined();
        expect(JSON.stringify(request)).not.toContain(token);
        expect(JSON.stringify(request)).not.toContain(record.secret);
      }
    } finally {
      await new Promise<void>((resolve) => {
        squatter.closeAllConnections();
        squatter.close(() => resolve());
      });
    }
  }, 240_000);
});
