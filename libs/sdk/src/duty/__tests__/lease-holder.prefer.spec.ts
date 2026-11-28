/**
 * A preferred holder (#1358): `@Duty({ prefer })` lets a designated process take a lease over. A holder that is not
 * preferred hands the lease over at its next check, once what runs under it ended, and does not take it back while the
 * preferred process wants it.
 */
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { LeaseHolder } from '../lease-holder';

const START = 1_700_000_000_000;
const LEASE_MS = 3_000;
const KEY = 'demo:sweep';

interface Probe {
  holder: LeaseHolder;
  events: string[];
  logger: { info: jest.Mock; warn: jest.Mock };
}

function elapsed(): number {
  return Date.now() - START;
}

describe('LeaseHolder with prefer', () => {
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

  function probe(prefer: boolean | undefined, settled?: () => Promise<unknown>): Probe {
    const events: string[] = [];
    const logger = { info: jest.fn((message: string) => void events.push(`info: ${message}`)), warn: jest.fn() };
    const holder = new LeaseHolder({
      label: 'Duty "sweep"',
      key: KEY,
      leaseMs: LEASE_MS,
      storage,
      logger,
      onAcquired: () => void events.push(`acquired at ${elapsed()}`),
      onLost: () => void events.push(`stopped at ${elapsed()}`),
      ...(prefer === undefined ? {} : { prefer }),
      ...(settled ? { settled } : {}),
    });
    return { holder, events, logger };
  }

  async function start(...probes: Probe[]): Promise<void> {
    for (const { holder } of probes) {
      started.push(holder);
      await holder.start();
    }
  }

  it('takes the lease over from a holder that is not preferred, at its next check, after its work ended', async () => {
    let finishWork: () => void = () => undefined;
    const work = new Promise<void>((resolve) => (finishWork = resolve));
    const other = probe(false, () => work);
    const preferred = probe(true);
    await start(other, preferred);
    expect(other.holder.holding).toBe(true);
    expect(preferred.holder.holding).toBe(false);

    // The other one sees the preference at its next check, stops, and waits for its work to end
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);
    expect(other.events).toContain(`stopped at ${LEASE_MS / 3}`);
    expect(other.holder.holding).toBe(false);
    expect(await storage.get(KEY)).toBe(other.holder.id);

    finishWork();
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);
    expect(other.events).toContain('info: Duty "sweep" hands its lease over to a preferred process');
    expect(preferred.holder.holding).toBe(true);
    expect(await storage.get(KEY)).toBe(preferred.holder.id);
  });

  it('leaves a free lease to the preferred process while it wants it', async () => {
    const preferred = probe(true);
    await start(preferred);
    await preferred.holder.stop(() => undefined);
    started.splice(started.indexOf(preferred.holder), 1);
    // A preferred process that wants the lease, and holds it a moment later
    await storage.set(`${KEY}:prefer`, 'someone-preferred', { ttlSeconds: 3 });

    const other = probe(false);
    await start(other);
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);
    expect(other.holder.holding).toBe(false);

    // Once that one stops wanting it, its preference ends with a lease, and the other one takes the lease
    await jest.advanceTimersByTimeAsync(LEASE_MS * 2);
    expect(other.holder.holding).toBe(true);
  });

  it('hands the lease back at once when the preferred process stops', async () => {
    const other = probe(false);
    const preferred = probe(true);
    await start(other, preferred);
    await jest.advanceTimersByTimeAsync((LEASE_MS / 3) * 2);
    expect(preferred.holder.holding).toBe(true);

    await preferred.holder.stop(() => undefined);
    started.splice(started.indexOf(preferred.holder), 1);
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);

    expect(other.holder.holding).toBe(true);
    expect(await storage.get(`${KEY}:prefer`)).toBeNull();
  });

  it('keeps the lease of a preferred holder against another preferred process, which contends as any does', async () => {
    const first = probe(true);
    const second = probe(true);
    await start(first, second);
    await jest.advanceTimersByTimeAsync(LEASE_MS * 2);

    expect(first.holder.holding).toBe(true);
    expect(second.holder.holding).toBe(false);
  });

  it('looks at no preference when the duty states none', async () => {
    const get = jest.spyOn(storage, 'get');
    const first = probe(undefined);
    const second = probe(undefined);
    await start(first, second);
    await jest.advanceTimersByTimeAsync(LEASE_MS);

    expect(get).not.toHaveBeenCalled();
    expect(first.holder.holding).toBe(true);
  });
});
