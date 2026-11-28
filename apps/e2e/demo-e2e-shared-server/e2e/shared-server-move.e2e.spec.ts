/**
 * E2E: a live session moves to the server of another key (#1349). Its key is read from a file again each time the file
 * changes; the session attaches to the new key's server, which it starts from the entry its config names, while its
 * client keeps calling: no call fails, the client hears the lists changed, and channel events come from the new server.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ATTACH_TIMEOUT_MS,
  callServerPid,
  running,
  serverPidOf,
  SharedSessions,
  waitUntil,
} from './helpers/shared-sessions';

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
      fs.writeFileSync(keyFile, 'e2e');
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

      fs.writeFileSync(keyFile, 'e2e-two\n');
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
      const record = JSON.parse(fs.readFileSync(path.join(shared.home, 'shared', 'e2e-two', 'server.json'), 'utf8'));
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
    fs.writeFileSync(keyFile, 'e2e');
    const session = shared.start('unix', { SHARED_KEY_FILE: keyFile, SHARED_ATTACH_BUDGET_MS: '1000' });
    const first = await serverPidOf(session);

    fs.writeFileSync(keyFile, 'e2e-three\n');
    await waitUntil(
      () => session.stderrLines.some((line) => line.includes('staying on the shared server "e2e"')),
      ATTACH_TIMEOUT_MS,
      'the session to stay',
    );

    expect(await callServerPid(session, 50)).toBe(first);
    expect(fs.existsSync(path.join(shared.home, 'shared', 'e2e-three', 'server.json'))).toBe(false);
  }, 240_000);
});
