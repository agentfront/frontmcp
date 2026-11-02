/**
 * E2E: a shared local server is upgraded, refused, bypassed and retired with live stdio sessions. A session of a newer
 * version replaces the older server and the sessions on it move to the new one; a session that may not replace an
 * older server, that finds its key taken by another server, or that finds its server wedged, runs the server in its
 * own process; the server exits once its checkout is removed or it is idle.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { deriveSharedServerKeys } from '@frontmcp/auth';

import { callServerPid, running, serverPidOf, SharedSessions, waitUntil } from './helpers/shared-sessions';

const EXIT_TIMEOUT_MS = 30_000;

describe('running a shared local server', () => {
  let shared: SharedSessions;

  beforeEach(() => {
    shared = new SharedSessions();
  });

  afterEach(async () => {
    await shared.cleanup();
  });

  it.each(['unix', 'http'] as const)(
    'swaps an older server for a newer one under a live session, which keeps working (%s)',
    async (transport) => {
      const older = shared.start(transport, { SHARED_APP_VERSION: '1.0.0' });
      const olderServer = await serverPidOf(older);
      const olderRecord = shared.readRecord();

      const newer = shared.start(transport, { SHARED_APP_VERSION: '2.0.0' });
      const newerServer = await serverPidOf(newer);

      expect(newerServer).not.toBe(olderServer);
      expect([older.pid, newer.pid]).not.toContain(newerServer);
      await waitUntil(() => !running(olderServer), EXIT_TIMEOUT_MS, 'the older server to exit');
      expect(shared.readRecord().pid).toBe(newerServer);

      expect(await callServerPid(older, 3)).toBe(newerServer);
      await older.waitFor(({ method }) => method === 'notifications/tools/list_changed', EXIT_TIMEOUT_MS);
      expect(await callServerPid(newer, 3)).toBe(newerServer);

      const written = [shared.logs(), ...older.stderrLines, ...newer.stderrLines].join('\n');
      expect(written).toContain('exits: a session of version 2.0.0 replaces it');
      for (const { secret } of [olderRecord, shared.readRecord()]) {
        expect(written).not.toContain(secret);
        expect(written).not.toContain(deriveSharedServerKeys(secret).token);
      }
    },
    240_000,
  );

  it('never attaches to an older server it may not replace: it runs the server in its own process, once announced', async () => {
    const older = shared.start('unix', { SHARED_APP_VERSION: '1.0.0' });
    const olderServer = await serverPidOf(older);

    const refusing = shared.start('unix', { SHARED_APP_VERSION: '2.0.0', SHARED_REPLACE_OLDER: '0' });
    expect(await serverPidOf(refusing)).toBe(refusing.pid);
    expect(await callServerPid(refusing, 3)).toBe(refusing.pid);

    expect(running(olderServer)).toBe(true);
    expect(await callServerPid(older, 3)).toBe(olderServer);
    expect(shared.readRecord().pid).toBe(olderServer);
    expect(refusing.stderrLines.filter((line) => line.includes('in this process'))).toEqual([
      '[frontmcp shared] warn running the shared server "e2e" in this process: the shared server runs version 1.0.0, ' +
        "older than this session's 2.0.0, and replaceOlder is off",
    ]);
  }, 240_000);

  it('never attaches to, nor replaces, the server of another info.name that took its key', async () => {
    const first = shared.start('unix', { SHARED_APP_VERSION: '1.0.0' });
    const firstServer = await serverPidOf(first);

    const other = shared.start('unix', { SHARED_APP_NAME: 'another-e2e', SHARED_APP_VERSION: '2.0.0' });
    expect(await serverPidOf(other)).toBe(other.pid);

    expect(running(firstServer)).toBe(true);
    expect(await callServerPid(first, 3)).toBe(firstServer);
    expect(shared.readRecord().pid).toBe(firstServer);
    expect(other.stderrLines.filter((line) => line.includes('in this process'))).toEqual([
      '[frontmcp shared] warn running the shared server "e2e" in this process: its key is taken by a server of ' +
        'another info.name; give each server a key of its own',
    ]);
  }, 240_000);

  it('runs the server in its own process when the shared server is wedged', async () => {
    const first = shared.start('unix');
    const wedged = await serverPidOf(first);
    process.kill(wedged, 'SIGSTOP');
    try {
      const started = Date.now();
      const bypassing = shared.start('unix', { SHARED_ATTACH_BUDGET_MS: '3000' });

      expect(await serverPidOf(bypassing)).toBe(bypassing.pid);
      expect(Date.now() - started).toBeLessThan(60_000);
      const announced = bypassing.stderrLines.filter((line) => line.includes('in this process'));
      expect(announced).toHaveLength(1);
      expect(announced[0]).toMatch(/^\[frontmcp shared\] warn running the shared server "e2e" in this process: /);
    } finally {
      process.kill(wedged, 'SIGCONT');
    }
  }, 240_000);

  it.each(['unix', 'http'] as const)(
    'exits once its checkout is removed, taking its record and socket with it (%s)',
    async (transport) => {
      const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-e2e-checkout-'));
      try {
        const session = shared.start(transport, { SHARED_CHECKOUT: checkout });
        const server = await serverPidOf(session);

        fs.rmSync(checkout, { recursive: true, force: true });

        await waitUntil(() => !running(server), EXIT_TIMEOUT_MS, 'the server to exit');
        expect(fs.existsSync(shared.recordFile)).toBe(false);
        expect(fs.existsSync(shared.socketPath)).toBe(false);
        expect(shared.logs()).toContain(`exits: its checkout ${checkout} was removed`);
      } finally {
        fs.rmSync(checkout, { recursive: true, force: true });
      }
    },
    240_000,
  );

  it('exits once idle after its last session left', async () => {
    const session = shared.start('unix', { SHARED_IDLE_TIMEOUT_MS: '2000' });
    const server = await serverPidOf(session);
    expect(await session.closeStdin()).toBe(0);

    await waitUntil(() => !running(server), EXIT_TIMEOUT_MS, 'the idle server to exit');
    expect(fs.existsSync(shared.recordFile)).toBe(false);
    expect(fs.existsSync(shared.socketPath)).toBe(false);
  }, 240_000);
});
