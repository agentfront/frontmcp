/**
 * E2E: three servers on one machine share a `@Worker`'s lease. One of them runs it; when it is killed, another takes
 * it over once the lease runs out, and when it stops gracefully its run ends first and it hands the lease over at once.
 * A run that throws is started again in the same server.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { killAll, spawnWorker, type Worker } from './helpers/workers';

const SERVERS = 3;
const LEASE_MS = 3_000;

function pidsThat(workers: Worker<unknown>[], word: string): number[] {
  return workers
    .flatMap(({ lines }) => lines.filter((line) => line.startsWith(`${word} `)))
    .map((line) => Number(line.split(' ')[1]));
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

describe('@Worker across processes', () => {
  let home: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-workers-'));
  });

  afterEach(() => {
    killAll(started);
    fs.rmSync(home, { recursive: true, force: true });
  });

  function spawnServers(count: number, env: Record<string, string> = {}): Worker<unknown>[] {
    started = Array.from({ length: count }, () =>
      spawnWorker('worker-server.ts', { FRONTMCP_HOME: home, LEASE_MS: String(LEASE_MS), ...env }),
    );
    return started;
  }

  it('runs in one of three servers, and another takes over when the holder dies or stops', async () => {
    const workers = spawnServers(SERVERS);
    await Promise.all(workers.map((worker) => worker.waitFor('ready')));

    await waitUntil(() => pidsThat(workers, 'running').length >= 1, 30_000, 'a holder');
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS));
    expect(pidsThat(workers, 'running')).toHaveLength(1);

    const first = workerOf(workers, pidsThat(workers, 'running')[0]);
    first.child.kill('SIGKILL');
    const survivors = workers.filter((worker) => worker !== first);
    await waitUntil(() => pidsThat(survivors, 'running').length >= 1, LEASE_MS * 4, 'a takeover after a kill');
    expect(pidsThat(survivors, 'running')).toHaveLength(1);

    const second = workerOf(survivors, pidsThat(survivors, 'running')[0]);
    const terminatedAt = Date.now();
    second.child.kill('SIGTERM');
    await expect(second.result).resolves.toEqual({ stopped: true });
    expect(pidsThat([second], 'ended')).toEqual([second.child.pid]);

    const rest = survivors.filter((worker) => worker !== second);
    await waitUntil(() => pidsThat(rest, 'running').length >= 1, LEASE_MS * 4, 'a takeover after a graceful stop');
    expect(Date.now() - terminatedAt).toBeLessThan(LEASE_MS * 2);
    expect(pidsThat(rest, 'running')).toHaveLength(1);
  });

  it('starts a run that throws again in the same server', async () => {
    const [worker] = spawnServers(1, { FAIL_FIRST_RUNS: '2' });
    await worker.waitFor('ready');

    await waitUntil(() => pidsThat([worker], 'running').length >= 1, 30_000, 'a run that stays up');

    expect(pidsThat([worker], 'failed')).toEqual([worker.child.pid, worker.child.pid]);
    expect(pidsThat([worker], 'running')).toEqual([worker.child.pid]);
  });
});
