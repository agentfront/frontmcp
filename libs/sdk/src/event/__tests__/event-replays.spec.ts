import { createMemoryStorage, type NamespacedStorage } from '@frontmcp/utils';

import { type EventCheckResult, type EventEntry } from '../../common';
import { type NewEventDelivery } from '../delivery/event-outbox';
import { EventReplays, MAX_PENDING_BATCHES, REPLAY_LEASE_MS } from '../replay/event-replays';
import { type EventReplayState, type EventSubscriptionRecord } from '../subscription/event-subscription.store';

const NOW = 1_800_000_000_000;
const INTERVAL_MS = 30_000;
type Checked = EventCheckResult<Record<string, unknown>>;

function subscription(overrides: Partial<EventSubscriptionRecord> = {}): EventSubscriptionRecord {
  return {
    id: 'sub_0001',
    principalKey: 'principal:ada',
    subscriber: { sub: 'ada', roles: [], permissions: [], scopes: [], claims: {} },
    eventName: 'ticket.updated',
    arguments: { queue: 'billing' },
    argumentsKey: '{"queue":"billing"}',
    delivery: { mode: 'webhook', url: 'https://hooks.example.com/mcp', secret: 'whsec_secret' },
    dialect: 'sep-3415',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 3_600_000,
    verifiedAt: NOW,
    lastAuthorizedAt: NOW,
    active: true,
    status: {},
    ...overrides,
  };
}

async function harness(storage?: NamespacedStorage) {
  const leaseStorage = storage ?? createMemoryStorage({ prefix: 'spec:events:' });
  if (!storage) await leaseStorage.connect();
  const check = jest.fn<Promise<Checked> | Checked, [Record<string, unknown>, string | null, unknown]>();
  const event = {
    name: 'ticket.updated',
    create: () => ({ check }),
    parsePayload: (data: { ticketId?: unknown }) => {
      if (typeof data.ticketId !== 'string') throw new Error('ticketId must be a string');
      return data;
    },
  } as unknown as EventEntry;
  const records = new Map<string, EventSubscriptionRecord>();
  const pendingDeliveries = new Set<string>();
  let nextDelivery = 1;
  const enqueue = jest.fn(async (_delivery: NewEventDelivery) => {
    const id = `dlv_${nextDelivery++}`;
    pendingDeliveries.add(id);
    return id;
  });
  const update = jest.fn(async (id: string, patch: { replay?: EventReplayState }) => {
    const record = records.get(id);
    if (record) records.set(id, { ...record, ...patch });
    return records.get(id);
  });
  const warn = jest.fn();
  const logger = { child: () => ({ warn, info: jest.fn() }) };
  const replays = new EventReplays({
    store: { listByEvent: async () => [...records.values()], update: update as never },
    outbox: { enqueue: enqueue as never, isPending: async (id) => pendingDeliveries.has(id) },
    storage: leaseStorage,
    intervalMs: INTERVAL_MS,
    maxEvents: 100,
    maxBodyBytes: 500,
    logger: logger as never,
  });
  const acknowledge = (...ids: string[]) => ids.forEach((id) => pendingDeliveries.delete(id));
  return { replays, event, check, records, enqueue, update, warn, acknowledge, storage: leaseStorage };
}

function bodyOf(enqueue: jest.Mock, call: number): Record<string, unknown> {
  return JSON.parse(enqueue.mock.calls[call][0].body);
}

describe('EventReplays', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('knows an event that reads an upstream from one that does not', async () => {
    const { replays, event } = await harness();

    expect(replays.isReplayable(event)).toBe(true);
    expect(replays.isReplayable({ create: () => ({}) } as unknown as EventEntry)).toBe(false);
  });

  describe('a new subscription', () => {
    it('starts from now on a null cursor: the position of the upstream is its cursor and its watermark', async () => {
      const { replays, event, check, enqueue, update } = await harness();
      check.mockResolvedValue({ events: [], cursor: '5' });

      const step = await replays.begin(event, subscription(), null, 60_000);

      expect(check).toHaveBeenCalledWith({ queue: 'billing' }, null, { maxEvents: 100 });
      expect(step).toEqual({ replay: { cursor: '5', watermark: '5', pending: [] }, truncated: false, hasMore: false });
      expect(enqueue).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith('sub_0001', { replay: step.replay });
    });

    it('replays from the cursor of its request, and keeps the watermark behind what is not acknowledged', async () => {
      const { replays, event, check, enqueue, acknowledge } = await harness();
      check.mockResolvedValue({
        events: [
          { data: { ticketId: 't-1' } },
          { data: { ticketId: 't-2' }, eventId: 'evt_upstream', timestamp: '2026-10-01T10:00:00.000Z' },
        ],
        cursor: '4',
        nextPollMs: 5000,
      });
      const record = subscription();

      const step = await replays.begin(event, record, '2', undefined);

      expect(check).toHaveBeenCalledWith({ queue: 'billing' }, '2', { maxEvents: 100 });
      expect(step.replay).toEqual({
        cursor: '4',
        watermark: '2',
        pending: [{ cursor: '4', deliveryIds: ['dlv_1', 'dlv_2'] }],
      });
      expect(enqueue.mock.calls[0][0]).toMatchObject({
        kind: 'event',
        subscriptionId: 'sub_0001',
        eventName: 'ticket.updated',
        webhookId: expect.stringMatching(/^msg_/),
      });
      expect(bodyOf(enqueue, 0)).toEqual({
        eventId: expect.stringMatching(/^evt_/),
        name: 'ticket.updated',
        timestamp: new Date(NOW).toISOString(),
        data: { ticketId: 't-1' },
        cursor: '2',
      });
      expect(bodyOf(enqueue, 1)).toMatchObject({
        eventId: 'evt_upstream',
        timestamp: '2026-10-01T10:00:00.000Z',
        cursor: '2',
      });

      acknowledge('dlv_1');
      expect((await replays.refresh(record, step.replay)).replay.watermark).toBe('2');
      acknowledge('dlv_2');
      expect(await replays.refresh(record, step.replay)).toEqual({
        replay: { cursor: '4', watermark: '4', pending: [] },
        truncated: false,
        hasMore: false,
      });
    });

    it('says truncated when the upstream cut the cursor, or maxAgeMs left events out', async () => {
      const { replays, event, check, enqueue } = await harness();
      check.mockResolvedValueOnce({ events: [], cursor: '9', truncated: true });
      const cut = await replays.begin(event, subscription(), '1', undefined);

      const old = new Date(NOW - 3_600_000).toISOString();
      check.mockResolvedValueOnce({
        events: [{ data: { ticketId: 't-old' }, timestamp: old }, { data: { ticketId: 't-new' } }],
        cursor: '11',
      });
      const aged = await replays.begin(event, subscription({ id: 'sub_0002' }), '9', 60_000);

      expect(cut.truncated).toBe(true);
      expect(check).toHaveBeenLastCalledWith({ queue: 'billing' }, '9', { maxEvents: 100, maxAgeMs: 60_000 });
      expect(aged.truncated).toBe(true);
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(bodyOf(enqueue, 0)).toMatchObject({ data: { ticketId: 't-new' } });
    });

    it('uses the event id as webhook-id for a subscription of the sketch dialect', async () => {
      const { replays, event, check, enqueue } = await harness();
      check.mockResolvedValue({ events: [{ data: { ticketId: 't-1' }, eventId: 'evt_7' }], cursor: '2' });

      await replays.begin(event, subscription({ dialect: 'sketch' }), '1', undefined);

      expect(enqueue.mock.calls[0][0].webhookId).toBe('evt_7');
    });

    it('keeps its position when check() throws, and leaves out data that is not the payload or is too large', async () => {
      const { replays, event, check, enqueue, warn } = await harness();
      check.mockRejectedValueOnce(new Error('upstream 503'));
      const failed = await replays.begin(event, subscription(), '3', undefined);

      check.mockResolvedValueOnce({
        events: [{ data: { ticketId: 7 } }, { data: { ticketId: 'x'.repeat(600) } }, { data: { ticketId: 't-1' } }],
        cursor: '6',
      });
      const partial = await replays.begin(event, subscription(), '3', undefined);

      expect(failed.replay).toEqual({ cursor: '3', watermark: '3', pending: [] });
      expect(warn).toHaveBeenCalledWith(
        'check() of event "ticket.updated" failed for subscription sub_0001',
        expect.any(Error),
      );
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(partial.replay.pending).toEqual([{ cursor: '6', deliveryIds: ['dlv_1'] }]);
      expect(warn).toHaveBeenCalledWith(
        'check() of event "ticket.updated" returned data that is not its payload',
        expect.any(Error),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('over the 500 byte limit; it is not delivered'));
    });
  });

  describe('the loop of an event', () => {
    it('reads the upstream for each active subscription that has a position, at each interval', async () => {
      const { replays, event, check, records, enqueue } = await harness();
      records.set('sub_0001', subscription({ replay: { cursor: '1', watermark: '1', pending: [] } }));
      records.set(
        'sub_idle',
        subscription({ id: 'sub_idle', active: false, replay: { cursor: '1', watermark: '1', pending: [] } }),
      );
      records.set('sub_new', subscription({ id: 'sub_new' }));
      check
        .mockResolvedValueOnce({ events: [{ data: { ticketId: 't-1' } }], cursor: '2' })
        .mockResolvedValue({ events: [], cursor: '2' });

      await replays.start([event]);
      await jest.advanceTimersByTimeAsync(0);

      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledWith({ queue: 'billing' }, '1', { maxEvents: 100 });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(records.get('sub_0001')?.replay).toEqual({
        cursor: '2',
        watermark: '1',
        pending: [{ cursor: '2', deliveryIds: ['dlv_1'] }],
      });

      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(check).toHaveBeenCalledTimes(2);
      await replays.stop();
    });

    it('reads again at once while check() has more, and waits the interval check() asks for', async () => {
      const { replays, event, check, records } = await harness();
      records.set('sub_0001', subscription({ replay: { cursor: '1', watermark: '1', pending: [] } }));
      check
        .mockResolvedValueOnce({ events: [], cursor: '2', hasMore: true })
        .mockResolvedValue({ events: [], cursor: '3', nextPollMs: 90_000 });

      await replays.start([event]);
      await jest.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(INTERVAL_MS * 2);
      expect(check).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(check).toHaveBeenCalledTimes(3);
      expect(records.get('sub_0001')?.replay).toEqual({ cursor: '3', watermark: '3', pending: [] });
      await replays.stop();
    });

    it('sends a gap envelope with the watermark when the upstream skipped events, to a dialect that has one', async () => {
      const { replays, event, check, records, enqueue } = await harness();
      records.set('sub_0001', subscription({ replay: { cursor: '1', watermark: '1', pending: [] } }));
      check.mockResolvedValue({ events: [], cursor: '9', truncated: true });

      await replays.start([event]);
      await jest.advanceTimersByTimeAsync(0);

      expect(enqueue.mock.calls[0][0]).toMatchObject({
        kind: 'gap',
        subscriptionId: 'sub_0001',
        body: '{"type":"gap","cursor":"9"}',
        webhookId: expect.stringMatching(/^msg_gap_/),
      });
      expect(records.get('sub_0001')?.replay).toEqual({ cursor: '9', watermark: '9', pending: [] });
      await replays.stop();
    });

    it('keeps a gap for the next refresh of a subscription of the sketch dialect, and tells it once', async () => {
      const { replays, event, check, records, enqueue } = await harness();
      const record = subscription({ dialect: 'sketch', replay: { cursor: '1', watermark: '1', pending: [] } });
      records.set('sub_0001', record);
      check
        .mockResolvedValueOnce({ events: [], cursor: '9', truncated: true })
        .mockResolvedValue({ events: [], cursor: '9' });

      await replays.start([event]);
      await jest.advanceTimersByTimeAsync(0);
      const stored = records.get('sub_0001')?.replay as EventReplayState;
      const refreshed = await replays.refresh(record, stored);
      const again = await replays.refresh(record, refreshed.replay);

      expect(enqueue).not.toHaveBeenCalled();
      expect(stored.truncated).toBe(true);
      expect(refreshed).toMatchObject({ truncated: true, replay: { cursor: '9', watermark: '9', pending: [] } });
      expect(refreshed.replay).not.toHaveProperty('truncated');
      expect(again.truncated).toBe(false);
      await replays.stop();
    });

    it('stops reading while too many batches wait for the callback', async () => {
      const { replays, event, check, records } = await harness();
      const pending = Array.from({ length: MAX_PENDING_BATCHES }, (_unused, index) => ({
        cursor: String(index + 2),
        deliveryIds: [`dlv_stuck_${index}`],
      }));
      records.set('sub_0001', subscription({ replay: { cursor: '60', watermark: '1', pending } }));
      const { outbox } = (
        replays as unknown as { options: { outbox: { isPending: (id: string) => Promise<boolean> } } }
      ).options;
      jest.spyOn(outbox, 'isPending').mockResolvedValue(true);

      await replays.start([event]);
      await jest.advanceTimersByTimeAsync(0);

      expect(check).not.toHaveBeenCalled();
      await replays.stop();
    });

    it('logs a turn that fails and runs the next one', async () => {
      const { replays, event, check, records, update, warn } = await harness();
      records.set('sub_0001', subscription({ replay: { cursor: '1', watermark: '1', pending: [] } }));
      check.mockResolvedValue({ events: [], cursor: '2' });
      const failure = new Error('store down');
      update.mockRejectedValueOnce(failure);

      await replays.start([event]);
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(warn).toHaveBeenCalledWith('The webhook loop of event "ticket.updated" failed', failure);
      expect(check).toHaveBeenCalledTimes(2);
      await replays.stop();
    });
  });

  describe('two processes', () => {
    it('run the loop of an event in one process, and in the other once the first stopped', async () => {
      const first = await harness();
      const second = await harness(first.storage);
      for (const each of [first, second]) {
        each.records.set('sub_0001', subscription({ replay: { cursor: '1', watermark: '1', pending: [] } }));
        each.check.mockResolvedValue({ events: [], cursor: '1' });
      }

      await first.replays.start([first.event]);
      await second.replays.start([second.event]);
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(first.check).toHaveBeenCalled();
      expect(second.check).not.toHaveBeenCalled();

      await first.replays.stop();
      const callsOfFirst = first.check.mock.calls.length;
      await jest.advanceTimersByTimeAsync(REPLAY_LEASE_MS);

      expect(second.check).toHaveBeenCalled();
      expect(first.check).toHaveBeenCalledTimes(callsOfFirst);
      await second.replays.stop();
    });
  });
});
