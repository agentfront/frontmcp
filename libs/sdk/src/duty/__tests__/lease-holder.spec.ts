import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { LeaseHolder } from '../lease-holder';

const START = 1_700_000_000_000;
const LEASE_MS = 3_000;
const KEY = 'demo:inbox';

interface Probe {
  holder: LeaseHolder;
  events: string[];
  logger: { info: jest.Mock; warn: jest.Mock };
}

function elapsed(): number {
  return Date.now() - START;
}

describe('LeaseHolder', () => {
  let storage: RootStorage;
  let started: LeaseHolder[];

  beforeEach(async () => {
    jest.useFakeTimers({ now: START });
    storage = createMemoryStorage({ enableSweeper: false });
    await storage.connect();
    started = [];
  });

  afterEach(async () => {
    await Promise.all(started.map((holder) => holder.stop(() => undefined)));
    await storage.disconnect();
    jest.useRealTimers();
  });

  function probe(label = 'Worker "inbox"'): Probe {
    const events: string[] = [];
    const logger = { info: jest.fn(), warn: jest.fn((message: string) => void events.push(`warn: ${message}`)) };
    const holder = new LeaseHolder({
      label,
      key: KEY,
      leaseMs: LEASE_MS,
      storage,
      logger,
      onAcquired: () => void events.push(`acquired at ${elapsed()}`),
      onLost: () => void events.push(`lost at ${elapsed()}`),
    });
    return { holder, events, logger };
  }

  async function start(...probes: Probe[]): Promise<void> {
    for (const { holder } of probes) {
      started.push(holder);
      await holder.start();
    }
  }

  it('gives the lease to the first holder, and tells the others once that it is held elsewhere', async () => {
    const first = probe();
    const second = probe();
    await start(first, second);

    await jest.advanceTimersByTimeAsync(3 * LEASE_MS);

    expect(first.holder.holding).toBe(true);
    expect(second.holder.holding).toBe(false);
    expect(first.events).toEqual(['acquired at 0']);
    expect(second.events).toEqual([]);
    expect(await storage.get(KEY)).toBe(first.holder.id);
    expect(second.logger.info.mock.calls).toEqual([
      ['Worker "inbox" already runs elsewhere (lease "demo:inbox"); this one takes it over if that one stops'],
    ]);
  });

  it('stops what runs under the lease before it says that another process took it', async () => {
    const holder = probe();
    await start(holder);
    await jest.advanceTimersByTimeAsync(500);

    await storage.set(KEY, 'another-process', { ttlSeconds: 3 });
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);

    expect(holder.holder.holding).toBe(false);
    expect(holder.events).toEqual([
      'acquired at 0',
      'lost at 1000',
      'warn: Worker "inbox" lost its lease; another process runs it now',
    ]);
  });

  it('gives the lease up a third of a lease before the store could end it, and takes it again when the store answers', async () => {
    const holder = probe();
    await start(holder);
    await jest.advanceTimersByTimeAsync(500);

    const failing = jest.spyOn(storage, 'expireIfEquals').mockRejectedValue('connection lost');
    await jest.advanceTimersByTimeAsync(1_500);

    expect(holder.events).toEqual([
      'acquired at 0',
      'warn: Worker "inbox": the lease store failed: connection lost',
      'warn: Worker "inbox": the lease store failed: connection lost',
      'lost at 2000',
      'warn: Worker "inbox" could not renew its lease within 2000 ms; it stops here until it gets the lease again',
      'warn: Worker "inbox": the lease store failed: connection lost',
    ]);
    expect(await storage.get(KEY)).toBe(holder.holder.id);

    await jest.advanceTimersByTimeAsync(1_500);
    failing.mockRestore();
    expect(holder.events).toHaveLength(7);

    await jest.advanceTimersByTimeAsync(LEASE_MS);
    expect(holder.holder.holding).toBe(true);
    expect(holder.events.at(-1)).toBe('acquired at 4000');
  });

  it('keeps the lease through one failed renew, which it tries again half a renew period later', async () => {
    const holder = probe();
    await start(holder);
    await jest.advanceTimersByTimeAsync(500);

    jest.spyOn(storage, 'expireIfEquals').mockRejectedValueOnce('connection lost');
    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(holder.holder.holding).toBe(true);
    expect(holder.events).toEqual(['acquired at 0', 'warn: Worker "inbox": the lease store failed: connection lost']);
  });

  it('reports a store failure whose value has no string form, and keeps checking', async () => {
    const holder = probe();
    jest.spyOn(storage, 'set').mockRejectedValueOnce(Object.create(null));

    await start(holder);
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);

    expect(holder.events).toEqual([
      'warn: Worker "inbox": the lease store failed: [object Object]',
      'acquired at 1000',
    ]);
  });

  it('keeps renewing the lease on stop() until what ran under it has ended, then releases it', async () => {
    const first = probe();
    const second = probe();
    await start(first, second);
    await jest.advanceTimersByTimeAsync(500);

    let stopped = false;
    const stopping = first.holder
      .stop(() => new Promise<void>((resolve) => setTimeout(resolve, 2 * LEASE_MS)))
      .then(() => (stopped = true));
    await jest.advanceTimersByTimeAsync(2 * LEASE_MS - 1);

    expect(first.holder.stopping).toBe(true);
    expect(stopped).toBe(false);
    expect(await storage.get(KEY)).toBe(first.holder.id);
    expect(second.holder.holding).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await stopping;
    expect(await storage.get(KEY)).toBeNull();

    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);
    expect(second.holder.holding).toBe(true);
    expect(first.events).toEqual(['acquired at 0']);
  });

  it('stops renewing without releasing the lease when what ran under it did not end', async () => {
    const holder = probe();
    await start(holder);

    await holder.holder.stop(() => false);

    expect(holder.holder.holding).toBe(false);
    expect(await storage.get(KEY)).toBe(holder.holder.id);
    await jest.advanceTimersByTimeAsync(LEASE_MS);
    expect(await storage.get(KEY)).toBeNull();
  });

  it('leaves the lease of another process alone when it stops without holding it', async () => {
    const first = probe();
    const second = probe();
    await start(first, second);

    await second.holder.stop(() => undefined);
    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(await storage.get(KEY)).toBe(first.holder.id);
    expect(second.holder.holding).toBe(false);
  });

  it('never takes the lease once stop() was called', async () => {
    const holder = probe();
    started.push(holder.holder);

    const starting = holder.holder.start();
    await holder.holder.stop(() => undefined);
    await starting;
    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(await storage.get(KEY)).toBeNull();
    expect(holder.holder.holding).toBe(false);
    expect(holder.events).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a store that fails while it releases the lease', async () => {
    const holder = probe('Duty "sweep"');
    await start(holder);
    jest.spyOn(storage, 'deleteIfEquals').mockRejectedValueOnce(new Error('database is locked'));

    await holder.holder.stop(() => undefined);

    expect(holder.logger.warn).toHaveBeenCalledWith('Duty "sweep": the lease store failed: database is locked');
    expect(holder.holder.holding).toBe(false);
  });
});
