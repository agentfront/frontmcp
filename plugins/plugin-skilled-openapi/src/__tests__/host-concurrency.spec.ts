import { __resetHostConcurrencyForTests, withHostConcurrency } from '../executor/host-concurrency';

describe('withHostConcurrency (SECURITY-REVIEW B6)', () => {
  beforeEach(() => __resetHostConcurrencyForTests());

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('never exceeds the per-host limit and always drains the queue', async () => {
    const limit = 2;
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, () => deferred());

    const tasks = gates.map((g, i) =>
      withHostConcurrency('api.example.com', limit, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await g.promise;
        active -= 1;
        return i;
      }),
    );

    // Let the first wave acquire slots.
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBeLessThanOrEqual(limit);

    // Release tasks one at a time; the limit must hold throughout.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      expect(active).toBeLessThanOrEqual(limit);
    }

    const results = await Promise.all(tasks);
    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(limit);
    expect(active).toBe(0);
  });

  it('isolates limits per host', async () => {
    let aActive = 0;
    let bActive = 0;
    let aPeak = 0;
    let bPeak = 0;
    const aGates = Array.from({ length: 3 }, () => deferred());
    const bGates = Array.from({ length: 3 }, () => deferred());

    const aTasks = aGates.map((g) =>
      withHostConcurrency('a.example.com', 1, async () => {
        aActive += 1;
        aPeak = Math.max(aPeak, aActive);
        await g.promise;
        aActive -= 1;
      }),
    );
    const bTasks = bGates.map((g) =>
      withHostConcurrency('b.example.com', 1, async () => {
        bActive += 1;
        bPeak = Math.max(bPeak, bActive);
        await g.promise;
        bActive -= 1;
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    // Each host independently caps at 1, so 2 tasks run concurrently across hosts.
    expect(aActive).toBe(1);
    expect(bActive).toBe(1);

    [...aGates, ...bGates].forEach((g) => g.resolve());
    await Promise.all([...aTasks, ...bTasks]);
    expect(aPeak).toBe(1);
    expect(bPeak).toBe(1);
  });

  it('runs immediately (no gating) when the limit is non-positive or non-finite', async () => {
    await expect(withHostConcurrency('h', 0, async () => 'a')).resolves.toBe('a');
    await expect(withHostConcurrency('h', -1, async () => 'b')).resolves.toBe('b');
    await expect(withHostConcurrency('h', Infinity, async () => 'c')).resolves.toBe('c');
  });

  it('releases the slot even when the task throws', async () => {
    await expect(
      withHostConcurrency('h', 1, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // A subsequent task must still be able to acquire.
    await expect(withHostConcurrency('h', 1, async () => 'ok')).resolves.toBe('ok');
  });
});
