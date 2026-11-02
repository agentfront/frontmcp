/**
 * E2E: five servers on one machine share a `@Duty`'s lease. One of them runs it each interval; when it is killed,
 * another takes over once the lease runs out, and when it stops gracefully it hands the lease over at once.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { killAll, spawnWorker, type Worker } from './helpers/workers';

const SERVERS = 5;
const EVERY_MS = 500;
const LEASE_MS = 12_000;

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

function workerOf(workers: Worker<unknown>[], pid: number): Worker<unknown> {
  const found = workers.find(({ child }) => child.pid === pid);
  if (!found) throw new Error(`no worker with pid ${pid}`);
  return found;
}

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** One process ran every run, and no two runs came closer than half an interval. */
function expectOneHolderOncePerInterval(runs: Run[]): void {
  expect(new Set(runs.map(({ pid }) => pid)).size).toBe(1);
  for (let index = 1; index < runs.length; index++) {
    expect(runs[index].at - runs[index - 1].at).toBeGreaterThanOrEqual(EVERY_MS / 2);
  }
}

describe('@Duty across processes', () => {
  let home: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-duties-'));
  });

  afterEach(() => {
    killAll(started);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('runs once per interval in one of five servers, and another takes over when the holder dies or stops', async () => {
    const workers = Array.from({ length: SERVERS }, () =>
      spawnWorker('duty-server.ts', { FRONTMCP_HOME: home, EVERY_MS: String(EVERY_MS), LEASE_MS: String(LEASE_MS) }),
    );
    started = workers;
    await Promise.all(workers.map((worker) => worker.waitFor('ready')));

    await waitUntil(() => runsOf(workers).length >= 6, 30_000, 'six runs');
    const beforeKill = runsOf(workers);
    expectOneHolderOncePerInterval(beforeKill);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(home, 'duties.sqlite')).mode & 0o777).toBe(0o600);

    const first = workerOf(workers, beforeKill[0].pid);
    const killedAt = Date.now();
    first.child.kill('SIGKILL');
    const survivors = workers.filter((worker) => worker !== first);
    await waitUntil(() => runsOf(survivors).length >= 4, LEASE_MS * 3, 'a takeover after the holder was killed');
    const afterKill = runsOf(survivors);
    expect(afterKill[0].at - killedAt).toBeLessThan(LEASE_MS * 2);
    expectOneHolderOncePerInterval(afterKill);

    const second = workerOf(survivors, afterKill[0].pid);
    const terminatedAt = Date.now();
    second.child.kill('SIGTERM');
    await expect(second.result).resolves.toEqual({ stopped: true });
    const lastRunOfSecond = runsOf([second]).at(-1)?.at ?? 0;
    const rest = survivors.filter((worker) => worker !== second);
    await waitUntil(() => runsOf(rest).length >= 2, LEASE_MS * 3, 'a takeover after the holder stopped');
    const afterStop = runsOf(rest);
    expect(afterStop[0].at - terminatedAt).toBeLessThan((LEASE_MS * 2) / 3);
    expect(afterStop[0].at - lastRunOfSecond).toBeGreaterThanOrEqual(EVERY_MS / 2);
    expectOneHolderOncePerInterval(afterStop);
  });
});
