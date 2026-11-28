/**
 * E2E: a live session moves to the server of another key (#1349). Its key is read from a file again each time the file
 * changes; the session attaches to the new key's server, which it starts from the entry its config names, while its
 * client keeps calling: no call fails, the client hears the lists changed, and channel events come from the new server.
 * It never moves to a process that does not prove it is that key's server, and when the server of the key it moved to
 * is gone for good, it moves back to its first key.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';

import { base64urlEncode, fileExists, mkdir, randomBytes, readFile, writeFile } from '@frontmcp/utils';

import {
  ATTACH_TIMEOUT_MS,
  callServerPid,
  running,
  serverPidOf,
  SharedSessions,
  waitUntil,
} from './helpers/shared-sessions';

/** A process on loopback that answers every request without proving anything, and records what it was sent. */
async function startSquatter(): Promise<{
  port: number;
  requests: http.IncomingHttpHeaders[];
  close(): Promise<void>;
}> {
  const requests: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.headers);
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe('a shared session that moves to another key', () => {
  let shared: SharedSessions;

  beforeEach(() => {
    shared = new SharedSessions();
  });

  afterEach(async () => {
    await shared.cleanup();
  });

  it.each(['unix', 'http'] as const)(
    'moves a live session to the server of another key while its client keeps calling (%s)',
    async (transport) => {
      const keyFile = path.join(shared.home, 'active-key');
      await writeFile(keyFile, 'e2e');
      const session = shared.start(transport, { SHARED_KEY_FILE: keyFile });
      const first = await serverPidOf(session);
      expect(first).not.toBe(session.pid);

      const answered: number[] = [];
      let calling = true;
      let id = 100;
      const caller = (async () => {
        while (calling) {
          answered.push(await callServerPid(session, id++));
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();
      await waitUntil(() => answered.length >= 3, ATTACH_TIMEOUT_MS, 'calls to the first server');

      await writeFile(keyFile, 'e2e-two\n');
      await waitUntil(
        () => answered.length > 0 && answered[answered.length - 1] !== first,
        ATTACH_TIMEOUT_MS,
        'calls to reach the server of e2e-two',
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      calling = false;
      await caller;

      const second = answered[answered.length - 1];
      expect([first, session.pid]).not.toContain(second);
      expect(new Set(answered)).toEqual(new Set([first, second]));
      const record = JSON.parse(await readFile(path.join(shared.home, 'shared', 'e2e-two', 'server.json')));
      shared.serverPids.add(record.pid);
      expect(record.pid).toBe(second);
      await session.waitFor(({ method }) => method === 'notifications/tools/list_changed', ATTACH_TIMEOUT_MS);
      expect(session.stderrLines.some((line) => line.includes('moved to the shared server "e2e-two"'))).toBe(true);

      const announced = await session.request(
        {
          jsonrpc: '2.0',
          id: 9_000,
          method: 'tools/call',
          params: { name: 'announce_build', arguments: { build: '7' } },
        },
        ATTACH_TIMEOUT_MS,
      );
      expect(announced.error).toBeUndefined();
      const event = await session.waitFor(
        ({ params }) => (params?.['meta'] as Record<string, unknown> | undefined)?.['build'] === '7',
        ATTACH_TIMEOUT_MS,
      );
      expect(event.params?.['content']).toBe(`Build 7 finished on server ${second}`);
      expect(running(first)).toBe(true);
    },
    240_000,
  );

  it('stays on its server, and says why, when the key file names a key it has no entry for and no server runs', async () => {
    const keyFile = path.join(shared.home, 'active-key');
    await writeFile(keyFile, 'e2e');
    const session = shared.start('unix', { SHARED_KEY_FILE: keyFile, SHARED_ATTACH_BUDGET_MS: '1000' });
    const first = await serverPidOf(session);

    await writeFile(keyFile, 'e2e-three\n');
    await waitUntil(
      () => session.stderrLines.some((line) => line.includes('staying on the shared server "e2e"')),
      ATTACH_TIMEOUT_MS,
      'the session to stay',
    );

    expect(await callServerPid(session, 50)).toBe(first);
    expect(await fileExists(path.join(shared.home, 'shared', 'e2e-three', 'server.json'))).toBe(false);
  }, 240_000);

  it("never moves to a process on the new key that does not prove it is that key's server", async () => {
    const keyFile = path.join(shared.home, 'active-key');
    await writeFile(keyFile, 'e2e');
    const session = shared.start('http', {
      SHARED_KEY_FILE: keyFile,
      SHARED_NO_ENTRIES: '1',
      SHARED_ATTACH_BUDGET_MS: '1500',
    });
    const first = await serverPidOf(session);
    const squatter = await startSquatter();
    try {
      const folder = path.join(shared.home, 'shared', 'e2e-two');
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const record = {
        name: 'shared-e2e',
        transport: 'http',
        port: squatter.port,
        path: '/',
        pid: process.pid,
        secret: base64urlEncode(randomBytes(32)),
      };
      await writeFile(path.join(folder, 'server.json'), JSON.stringify(record), { mode: 0o600 });

      await writeFile(keyFile, 'e2e-two\n');
      await waitUntil(
        () => session.stderrLines.some((line) => line.includes('staying on the shared server "e2e"')),
        ATTACH_TIMEOUT_MS,
        'the session to stay',
      );

      expect(squatter.requests.length).toBeGreaterThan(0);
      expect(squatter.requests.filter((headers) => headers['authorization'] !== undefined)).toEqual([]);
      expect(await callServerPid(session, 60)).toBe(first);
    } finally {
      await squatter.close();
    }
  }, 240_000);

  it('moves back to its first key, and says so, when the server of the key it moved to is gone for good', async () => {
    const otherKeyFile = path.join(shared.home, 'other-key');
    await writeFile(otherKeyFile, 'e2e-two');
    const other = shared.start('unix', { SHARED_KEY_FILE: otherKeyFile });
    const otherServer = await serverPidOf(other);

    const keyFile = path.join(shared.home, 'active-key');
    await writeFile(keyFile, 'e2e');
    const session = shared.start('unix', {
      SHARED_KEY_FILE: keyFile,
      SHARED_NO_ENTRIES: '1',
      SHARED_ATTACH_BUDGET_MS: '2000',
    });
    const first = await serverPidOf(session);
    await writeFile(keyFile, 'e2e-two\n');
    await waitUntil(
      () => session.stderrLines.some((line) => line.includes('moved to the shared server "e2e-two"')),
      ATTACH_TIMEOUT_MS,
      'the move',
    );
    expect(await callServerPid(session, 70)).toBe(otherServer);

    // Its only session leaves, and its server dies: nothing the session may start serves e2e-two now
    expect(await other.closeStdin()).toBe(0);
    process.kill(otherServer, 'SIGKILL');
    await waitUntil(() => !running(otherServer), ATTACH_TIMEOUT_MS, 'the server of e2e-two to die');

    expect(await callServerPid(session, 71)).toBe(first);
    expect(session.stderrLines.some((line) => line.includes('moving back to the shared server "e2e"'))).toBe(true);
    expect(session.stderrLines.some((line) => line.includes('in this process'))).toBe(false);
  }, 240_000);
});
