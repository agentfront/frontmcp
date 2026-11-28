/**
 * E2E: duty leases the app names, and a preferred holder (#1358). Servers whose duty has the same `scope: { key }`
 * share one lease, and one with another key runs its own; a server that prefers to run the duty takes it over from
 * one that does not, which stops, and gets it back once the preferred one stops.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { killAll, spawnWorker, type Worker } from './helpers/workers';

const EVERY_MS = 300;
const LEASE_MS = 3_000;

interface Run {
  pid: number;
  at: number;
}

function runsOf(workers: Worker<unknown>[]): Run[] {
  return workers
    .flatMap(({ lines }) => lines.filter((line) => line.startsWith('ran ')))
    .map((line) => {
      const [, pid, at] = line.split(' ');
      return { pid: Number(pid), at: Number(at) };
    })
    .sort((a, b) => a.at - b.at);
}

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('duty leases the app names, and a preferred holder', () => {
  let home: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-duty-keys-'));
    started = [];
  });

  afterEach(() => {
    killAll(started);
    fs.rmSync(home, { recursive: true, force: true });
  });

  function spawn(key: string, prefer = false): Worker<unknown> {
    const worker = spawnWorker('keyed-duty-server.ts', {
      FRONTMCP_HOME: home,
      EVERY_MS: String(EVERY_MS),
      LEASE_MS: String(LEASE_MS),
      LEASE_KEY: key,
      PREFER: prefer ? '1' : '0',
    });
    started.push(worker);
    return worker;
  }

  it('runs the duty in one server per key', async () => {
    const workers = [spawn('main'), spawn('main'), spawn('main'), spawn('other')];
    await Promise.all(workers.map((worker) => worker.waitFor('ready')));
    const [mainA, mainB, mainC, other] = workers.map(({ child }) => child.pid ?? 0);

    await waitUntil(
      () => runsOf(workers).some(({ pid }) => pid === other) && runsOf(workers).some(({ pid }) => pid !== other),
      30_000,
      'a run of each key',
    );
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS));

    const mainRunners = new Set(
      runsOf(workers)
        .map(({ pid }) => pid)
        .filter((pid) => pid !== other),
    );
    expect(mainRunners.size).toBe(1);
    expect([mainA, mainB, mainC]).toContain([...mainRunners][0]);
  }, 120_000);

  it('hands the duty to a preferred server, and takes it back once that one stops', async () => {
    const plain = spawn('main');
    await plain.waitFor('ready');
    await waitUntil(() => runsOf([plain]).length > 0, 30_000, 'the plain server to run the duty');

    const preferred = spawn('main', true);
    await preferred.waitFor('ready');
    await waitUntil(() => runsOf([preferred]).length > 0, 30_000, 'the preferred server to take the duty over');
    const takenOverAt = runsOf([preferred])[0].at;
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS));

    expect(runsOf([plain]).filter(({ at }) => at > takenOverAt)).toEqual([]);
    const preferredRuns = runsOf([preferred]).length;
    expect(preferredRuns).toBeGreaterThan(2);

    preferred.child.kill('SIGTERM');
    await preferred.result;
    const stoppedAt = Date.now();
    await waitUntil(
      () => runsOf([plain]).some(({ at }) => at > stoppedAt),
      30_000,
      'the plain server to run the duty again',
    );
  }, 120_000);
});
