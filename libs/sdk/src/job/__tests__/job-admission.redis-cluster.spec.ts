/**
 * The Redis job store's swaps on a real Redis Cluster (#1351): the lease list of a machine is swapped by one script on
 * one key, so two processes never both take the only slot, and a run's end is written only while it is unfinished.
 *
 * Runs when REDIS_CLUSTER_NODES lists the cluster's nodes (`host:port,host:port,...`), as
 * `scripts/redis-cluster-docker.sh up` prints; skipped otherwise.
 */
import { MachineJobAdmission } from '../job-admission';
import { createJobStateStore } from '../store/job-state-store.factory';
import { type JobStateStore } from '../store/job-state.interface';

const NODES = (process.env['REDIS_CLUSTER_NODES'] ?? '')
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean)
  .map((node) => {
    const [host, port] = node.split(':');
    return { host, port: Number(port) };
  });

const describeCluster = NODES.length > 0 ? describe : describe.skip;

async function admitted(acquiring: Promise<void>, withinMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), withinMs)));
  try {
    return await Promise.race([acquiring.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

describeCluster('MachineJobAdmission on a Redis Cluster', () => {
  const keyPrefix = `admission-spec:${Date.now()}:`;
  let stores: JobStateStore[];

  beforeAll(async () => {
    stores = await Promise.all(
      [0, 1].map(async () => (await createJobStateStore({ redis: { cluster: { nodes: NODES } }, keyPrefix })).store),
    );
  });

  afterAll(async () => {
    await Promise.all(stores.map((store) => store.dispose()));
  });

  it('swaps the lease list only from the value it holds', async () => {
    const [first, second] = stores;
    const key = 'admission:swap-box';
    expect(await first.readLeases?.(key)).toBe('');
    const fromNone = await Promise.all([
      first.swapLeases?.(key, '', 'mine', 30),
      second.swapLeases?.(key, '', 'theirs', 30),
    ]);
    expect(fromNone.filter(Boolean)).toHaveLength(1);
    const held = (await second.readLeases?.(key)) ?? '';
    expect(await first.swapLeases?.(key, 'stale', 'late', 30)).toBe(false);
    expect(await first.swapLeases?.(key, held, '[]', 1)).toBe(true);
    expect(await second.readLeases?.(key)).toBe('[]');
  });

  it('writes the end of a run only while it is unfinished', async () => {
    const [first, second] = stores;
    const runId = `run-${Date.now()}`;
    await first.createRun({
      runId,
      jobId: 'report',
      jobName: 'report',
      state: 'running',
      input: {},
      startedAt: Date.now(),
      attempt: 1,
      maxAttempts: 1,
      logs: [],
      background: true,
    });

    expect(await second.updateUnfinishedRun?.(runId, { state: 'cancelled' })).toBe(true);
    expect(await first.updateUnfinishedRun?.(runId, { state: 'completed' })).toBe(false);
    expect((await first.getRun(runId))?.state).toBe('cancelled');
  });

  it('admits one attempt at a time across two processes', async () => {
    const probes = { recheckMs: 10, hostname: () => 'cluster-box' };
    const [first, second] = stores.map(
      (store) =>
        new MachineJobAdmission(
          { concurrency: 1, scope: 'machine' },
          store as Required<Pick<JobStateStore, 'readLeases' | 'swapLeases'>>,
          undefined,
          probes,
        ),
    );
    const running = first.slot();
    await running.acquire('report');

    const waiting = second.slot();
    const acquiring = waiting.acquire('report');
    expect(await admitted(acquiring, 300)).toBe(false);
    running.release();
    expect(await admitted(acquiring, 3_000)).toBe(true);
    waiting.release();
  });
});
