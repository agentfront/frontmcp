import { createMemoryStorage, getRuntimeContext, type NamespacedStorage } from '@frontmcp/utils';

import { eventsConfigSchema } from '../../common/metadata/event.metadata';
import {
  EventOutbox,
  OUTBOX_SWEEP_INTERVAL_MS,
  type EventDeliveryOutcome,
  type EventDeliveryRecord,
  type EventOutboxOptions,
  type NewEventDelivery,
} from '../delivery/event-outbox';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const NOW = 1_800_000_000_000;
const settings = eventsConfigSchema.parse({}).webhook.delivery;
const delivered: EventDeliveryOutcome = { result: 'delivered' };
const failed: EventDeliveryOutcome = { result: 'failed', category: 'http_5xx' };

function delivery(overrides: Partial<NewEventDelivery> = {}): NewEventDelivery {
  return {
    kind: 'event',
    subscriptionId: 'sub_0001',
    eventName: 'order.created',
    body: '{"eventId":"evt_1"}',
    webhookId: 'msg_1',
    ...overrides,
  };
}

async function sharedStorage(): Promise<NamespacedStorage> {
  const storage = createMemoryStorage({ prefix: 'spec:events:' });
  await storage.connect();
  return storage;
}

interface Harness {
  outbox: EventOutbox;
  attempt: jest.Mock<Promise<EventDeliveryOutcome>, [EventDeliveryRecord]>;
  count: jest.Mock;
  warn: jest.Mock;
  storage: NamespacedStorage;
}

async function outboxOver(
  storage: NamespacedStorage,
  overrides: Partial<EventOutboxOptions> = {},
  outcomes: EventDeliveryOutcome[] = [],
): Promise<Harness> {
  const attempt = jest.fn<Promise<EventDeliveryOutcome>, [EventDeliveryRecord]>();
  for (const outcome of outcomes) attempt.mockResolvedValueOnce(outcome);
  attempt.mockResolvedValue(delivered);
  const count = jest.fn();
  const warn = jest.fn();
  const outbox = new EventOutbox({
    storage,
    durable: true,
    settings,
    attempt,
    metrics: { count },
    logger: { child: () => ({ warn }) } as never,
    random: () => 1,
    ...overrides,
  });
  return { outbox, attempt, count, warn, storage };
}

async function newOutbox(overrides: Partial<EventOutboxOptions> = {}, outcomes: EventDeliveryOutcome[] = []) {
  return outboxOver(await sharedStorage(), overrides, outcomes);
}

/** Lets timers that are due fire, and the promises they start settle. */
async function advance(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

describe('EventOutbox', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.mocked(getRuntimeContext).mockReset();
    jest.mocked(getRuntimeContext).mockImplementation(jest.requireActual('@frontmcp/utils').getRuntimeContext);
  });

  describe('a delivery', () => {
    it('is stored, attempted once and removed when the callback acknowledges it', async () => {
      const { outbox, attempt, count } = await newOutbox();

      await outbox.enqueue(delivery());
      await expect(outbox.depth()).resolves.toBe(1);
      await advance(0);

      expect(attempt).toHaveBeenCalledTimes(1);
      expect(attempt.mock.calls[0][0]).toMatchObject({
        id: expect.stringMatching(/^dlv_/),
        kind: 'event',
        subscriptionId: 'sub_0001',
        body: '{"eventId":"evt_1"}',
        webhookId: 'msg_1',
        attempt: 0,
        firstAttemptAt: NOW,
      });
      await expect(outbox.depth()).resolves.toBe(0);
      expect(count).toHaveBeenCalledWith('delivered', 'order.created');
    });

    it('is removed without a retry when it is dropped', async () => {
      const { outbox, attempt, count } = await newOutbox({}, [{ result: 'dropped', reason: 'refused' }]);

      await outbox.enqueue(delivery());
      await advance(settings.retryWindowMs);

      expect(attempt).toHaveBeenCalledTimes(1);
      await expect(outbox.depth()).resolves.toBe(0);
      expect(count).toHaveBeenCalledWith('dropped', 'order.created');
    });

    it('keeps its body and its webhook-id on every attempt', async () => {
      const { outbox, attempt } = await newOutbox({}, [failed, failed]);

      await outbox.enqueue(delivery());
      await advance(10_000);

      expect(attempt).toHaveBeenCalledTimes(3);
      for (const [record] of attempt.mock.calls) {
        expect(record).toMatchObject({ body: '{"eventId":"evt_1"}', webhookId: 'msg_1' });
      }
      expect(attempt.mock.calls.map(([record]) => record.attempt)).toEqual([0, 1, 2]);
    });
  });

  describe('retries', () => {
    it('wait twice as long after each failed attempt, up to the maximum', async () => {
      const slow = { ...settings, maxAttempts: 9, maxBackoffMs: 8_000 };
      const { outbox, attempt } = await newOutbox({ settings: slow });
      const startedAt: number[] = [];
      attempt.mockImplementation(async () => {
        startedAt.push(Date.now() - NOW);
        return startedAt.length <= 8 ? failed : delivered;
      });

      await outbox.enqueue(delivery());
      await advance(60_000);

      expect(startedAt).toEqual([0, 1000, 3000, 7000, 15_000, 23_000, 31_000, 39_000, 47_000]);
    });

    it('wait a random part less than the full backoff', async () => {
      const { outbox, attempt } = await newOutbox({ random: () => 0 }, [failed]);

      await outbox.enqueue(delivery());
      await advance(499);
      expect(attempt).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(attempt).toHaveBeenCalledTimes(2);
    });

    it('count each failed attempt', async () => {
      const { outbox, count } = await newOutbox({}, [failed, failed]);

      await outbox.enqueue(delivery());
      await advance(10_000);

      expect(count.mock.calls.map(([counter]) => counter)).toEqual(['retried', 'retried', 'delivered']);
    });

    it('stop after the last attempt: the delivery is abandoned, logged and counted', async () => {
      const { outbox, attempt, count, warn } = await newOutbox({}, new Array(5).fill(failed));

      await outbox.enqueue(delivery());
      await advance(settings.retryWindowMs);

      expect(attempt).toHaveBeenCalledTimes(settings.maxAttempts);
      await expect(outbox.depth()).resolves.toBe(0);
      expect(count).toHaveBeenLastCalledWith('abandoned', 'order.created');
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Delivery dlv_\S+ of event "order\.created" to subscription sub_0001 is abandoned after 5 attempt\(s\): http_5xx$/,
        ),
      );
    });

    it('stop once the retry window is over, whatever attempts are left', async () => {
      const patient = { ...settings, maxAttempts: 100, retryWindowMs: 10_000, maxBackoffMs: 4_000 };
      const { outbox, attempt, count } = await newOutbox({ settings: patient });
      attempt.mockResolvedValue(failed);

      await outbox.enqueue(delivery());
      await advance(60_000);

      expect(attempt).toHaveBeenCalledTimes(5);
      expect(count).toHaveBeenLastCalledWith('abandoned', 'order.created');
    });

    it('treat an attempt that throws as a failed one', async () => {
      const { outbox, attempt, warn } = await newOutbox();
      attempt.mockReset();
      const failure = new Error('flow crashed');
      attempt.mockRejectedValueOnce(failure).mockResolvedValue(delivered);

      await outbox.enqueue(delivery());
      await advance(1000);

      expect(attempt).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^The attempt of delivery dlv_\S+ threw$/), failure);
      await expect(outbox.depth()).resolves.toBe(0);
    });
  });

  describe('a delivery to a suspended subscription', () => {
    it('waits and looks again every 30 seconds, without using its attempts', async () => {
      const { outbox, attempt } = await newOutbox({}, [{ result: 'waiting' }, { result: 'waiting' }]);

      await outbox.enqueue(delivery());
      await advance(60_000);

      expect(attempt).toHaveBeenCalledTimes(3);
      expect(attempt.mock.calls.map(([record]) => record.attempt)).toEqual([0, 0, 0]);
    });

    it('is abandoned when the subscription is still suspended at the end of the retry window', async () => {
      const { outbox, attempt, warn } = await newOutbox();
      attempt.mockResolvedValue({ result: 'waiting' });

      await outbox.enqueue(delivery());
      await advance(settings.retryWindowMs + 30_000);

      await expect(outbox.depth()).resolves.toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('the subscription is suspended'));
    });
  });

  describe('concurrency', () => {
    it('keeps at most `concurrency` attempts in flight', async () => {
      const narrow = { ...settings, concurrency: 2 };
      const { outbox, attempt } = await newOutbox({ settings: narrow });
      const finish: Array<(outcome: EventDeliveryOutcome) => void> = [];
      attempt.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));

      for (let index = 0; index < 5; index++) await outbox.enqueue(delivery({ webhookId: `msg_${index}` }));
      await advance(0);
      expect(attempt).toHaveBeenCalledTimes(2);

      finish[0](delivered);
      await advance(0);
      expect(attempt).toHaveBeenCalledTimes(3);

      for (const done of finish.splice(1)) done(delivered);
      await advance(0);
      for (const done of finish.splice(1)) done(delivered);
      await advance(0);
      expect(attempt).toHaveBeenCalledTimes(5);
    });
  });

  describe('two processes over one store', () => {
    it('lets a second process finish a delivery whose holder died, once its lease expired', async () => {
      const storage = await sharedStorage();
      const dead = await outboxOver(storage);
      dead.attempt.mockImplementation(() => new Promise(() => undefined));
      const survivor = await outboxOver(storage);

      await dead.outbox.enqueue(delivery());
      await advance(0);
      expect(dead.attempt).toHaveBeenCalledTimes(1);

      await survivor.outbox.sweep(Date.now());
      await advance(0);
      expect(survivor.attempt).not.toHaveBeenCalled();

      jest.setSystemTime(NOW + settings.timeoutMs + 30_001);
      await survivor.outbox.sweep(Date.now());
      await advance(0);

      expect(survivor.attempt).toHaveBeenCalledTimes(1);
      expect(survivor.attempt.mock.calls[0][0]).toMatchObject({ webhookId: 'msg_1', firstAttemptAt: NOW });
      await expect(survivor.outbox.depth()).resolves.toBe(0);
    });

    it('does not attempt a delivery another process took over', async () => {
      const storage = await sharedStorage();
      const first = await outboxOver(storage, {}, [failed]);
      const second = await outboxOver(storage);

      await first.outbox.enqueue(delivery());
      await advance(0);
      jest.setSystemTime(NOW + settings.timeoutMs + 31_001);
      await second.outbox.sweep(Date.now());
      await advance(0);
      await advance(5_000);

      expect(first.attempt).toHaveBeenCalledTimes(1);
      expect(second.attempt).toHaveBeenCalledTimes(1);
    });

    it('takes a delivery only once when two processes sweep at the same time', async () => {
      const storage = await sharedStorage();
      const dead = await outboxOver(storage);
      dead.attempt.mockImplementation(() => new Promise(() => undefined));
      const one = await outboxOver(storage);
      const other = await outboxOver(storage);
      await dead.outbox.enqueue(delivery());
      await advance(0);
      jest.setSystemTime(NOW + settings.timeoutMs + 30_001);

      await Promise.all([one.outbox.sweep(Date.now()), other.outbox.sweep(Date.now())]);
      await advance(0);

      expect(one.attempt.mock.calls.length + other.attempt.mock.calls.length).toBe(1);
    });

    it('sweeps on start and every 30 seconds after', async () => {
      const storage = await sharedStorage();
      const dead = await outboxOver(storage);
      dead.attempt.mockImplementation(() => new Promise(() => undefined));
      await dead.outbox.enqueue(delivery());
      await advance(0);
      const survivor = await outboxOver(storage);

      survivor.outbox.start();
      await advance(0);
      expect(survivor.attempt).not.toHaveBeenCalled();

      await advance(settings.timeoutMs + 30_000 + OUTBOX_SWEEP_INTERVAL_MS);
      expect(survivor.attempt).toHaveBeenCalledTimes(1);
      await survivor.outbox.stop();
    });

    it('logs a sweep that fails', async () => {
      const { outbox, storage, warn } = await newOutbox();
      const failure = new Error('store down');
      jest.spyOn(storage, 'keys').mockRejectedValue(failure);

      outbox.start();
      await advance(0);

      expect(warn).toHaveBeenCalledWith('The outbox sweep failed', failure);
      await outbox.stop();
    });
  });

  describe('with a store that ends with the process', () => {
    it('does not sweep: nobody else can hold its deliveries', async () => {
      const { outbox, storage } = await newOutbox({ durable: false });
      const keys = jest.spyOn(storage, 'keys');

      outbox.start();
      await outbox.sweep();
      await advance(OUTBOX_SWEEP_INTERVAL_MS * 2);

      expect(keys).not.toHaveBeenCalled();
    });
  });

  describe('on shutdown', () => {
    it('waits for the attempt in flight and leaves the deliveries that did not start in the store', async () => {
      const { outbox, attempt } = await newOutbox({}, [failed]);
      let finish: (outcome: EventDeliveryOutcome) => void = () => undefined;
      attempt.mockReset();
      attempt.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

      await outbox.enqueue(delivery());
      await advance(0);
      const stopped = outbox.stop();
      let isStopped = false;
      void stopped.then(() => (isStopped = true));
      await advance(0);
      expect(isStopped).toBe(false);

      finish(failed);
      await stopped;
      await advance(settings.retryWindowMs);

      expect(attempt).toHaveBeenCalledTimes(1);
      await expect(outbox.depth()).resolves.toBe(1);
    });

    it('releases its leases, so another process takes its deliveries at once', async () => {
      const storage = await sharedStorage();
      const stopping = await outboxOver(storage, {}, [failed]);
      const next = await outboxOver(storage);
      await stopping.outbox.enqueue(delivery());
      await advance(0);

      await stopping.outbox.stop();
      await next.outbox.sweep(Date.now());
      await advance(1000);

      expect(stopping.attempt).toHaveBeenCalledTimes(1);
      expect(next.attempt).toHaveBeenCalledTimes(1);
      expect(next.attempt.mock.calls[0][0]).toMatchObject({ attempt: 1, webhookId: 'msg_1' });
    });

    it('keeps the leases of other processes, and logs a release that fails', async () => {
      const storage = await sharedStorage();
      const other = await outboxOver(storage);
      other.attempt.mockImplementation(() => new Promise(() => undefined));
      await other.outbox.enqueue(delivery());
      await advance(0);
      const stopping = await outboxOver(storage);

      await stopping.outbox.stop();
      const bystander = await outboxOver(storage);
      await bystander.outbox.sweep(Date.now());
      await advance(0);
      expect(bystander.attempt).not.toHaveBeenCalled();

      const failure = new Error('store down');
      jest.spyOn(storage, 'keys').mockRejectedValueOnce(failure);
      await stopping.outbox.stop();
      expect(stopping.warn).toHaveBeenCalledWith('The outbox leases were not released', failure);
    });

    it('starts no attempt for a delivery queued after it stopped', async () => {
      const { outbox, attempt } = await newOutbox();
      await outbox.stop();

      await outbox.enqueue(delivery());
      await advance(1000);

      expect(attempt).not.toHaveBeenCalled();
      await expect(outbox.depth()).resolves.toBe(1);
    });
  });

  describe('where no process is long-lived', () => {
    beforeEach(() => {
      jest.mocked(getRuntimeContext).mockReturnValue({ runtime: 'node', deployment: 'serverless' } as never);
    });

    it('makes the first attempt before enqueue returns, and starts no timer', async () => {
      const { outbox, attempt } = await newOutbox({}, [failed]);
      const timersBefore = jest.getTimerCount();

      await outbox.enqueue(delivery());

      expect(attempt).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(timersBefore);
      outbox.start();
      expect(jest.getTimerCount()).toBe(timersBefore);
    });

    it('never has more than `concurrency` attempts in flight, whenever a new one arrives as a slot is freed', async () => {
      const narrow = { ...settings, concurrency: 2 };
      const mostInFlight: number[] = [];

      for (let microtasksBeforeNewcomer = 0; microtasksBeforeNewcomer < 40; microtasksBeforeNewcomer++) {
        const { outbox, attempt } = await newOutbox({ settings: narrow });
        const finish: Array<(outcome: EventDeliveryOutcome) => void> = [];
        let finished = 0;
        let most = 0;
        attempt.mockImplementation(() => {
          most = Math.max(most, attempt.mock.calls.length - finished);
          return new Promise((resolve) => finish.push(resolve));
        });
        const finishAttempt = (index: number) => {
          finished += 1;
          finish[index](delivered);
        };

        const queued = [0, 1, 2].map((index) => outbox.enqueue(delivery({ webhookId: `msg_${index}` })));
        await advance(0);
        finishAttempt(0);
        for (let hop = 0; hop < microtasksBeforeNewcomer; hop++) await Promise.resolve();
        queued.push(outbox.enqueue(delivery({ webhookId: 'msg_newcomer' })));
        await advance(0);

        for (let index = 1; index < 4; index++) {
          finishAttempt(index);
          await advance(0);
        }
        await Promise.all(queued);
        mostInFlight.push(most);
      }

      expect(Math.max(...mostInFlight)).toBe(2);
    });

    it('leaves a retry to a later sweep, which runs it once it is due', async () => {
      const { outbox, attempt } = await newOutbox({}, [failed]);

      await outbox.enqueue(delivery());
      await outbox.sweepIfDue(NOW);
      await outbox.sweepIfDue(NOW + OUTBOX_SWEEP_INTERVAL_MS - 1);
      expect(attempt).toHaveBeenCalledTimes(1);

      jest.setSystemTime(NOW + OUTBOX_SWEEP_INTERVAL_MS);
      await outbox.sweepIfDue();
      await outbox.sweepIfDue();

      expect(attempt).toHaveBeenCalledTimes(2);
      await expect(outbox.depth()).resolves.toBe(0);
    });

    it('does not run a retry that is not due yet', async () => {
      const slow = { ...settings, backoffMs: 60_000, maxBackoffMs: 60_000 };
      const { outbox, attempt } = await newOutbox({ settings: slow }, [failed]);

      await outbox.enqueue(delivery());
      jest.setSystemTime(NOW + OUTBOX_SWEEP_INTERVAL_MS);
      await outbox.sweepIfDue();

      expect(attempt).toHaveBeenCalledTimes(1);
    });
  });

  describe('at rest', () => {
    it('stores nothing readable when it has a secret, and reads it back', async () => {
      const { outbox, attempt, storage } = await newOutbox({ secret: 'outbox-secret-for-specs' });
      const target = { url: 'https://hooks.example.com/mcp', secret: 'whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0' };

      await outbox.enqueue(delivery({ kind: 'terminated', target }));
      const stored = (await storage.mget(await storage.keys('outbox:*'))).join('\n');
      await advance(0);

      expect(stored).not.toContain(target.secret);
      expect(stored).not.toContain('hooks.example.com');
      expect(stored).not.toContain('evt_1');
      expect(attempt.mock.calls[0][0]).toMatchObject({ kind: 'terminated', target });
    });

    it('skips a record it cannot read', async () => {
      const { outbox, attempt, storage } = await newOutbox();
      await storage.set('outbox:dlv_broken', 'not a record');
      await storage.set('outbox:dlv_other', JSON.stringify({ id: 'dlv_another' }));

      await outbox.sweep();
      await advance(0);

      expect(attempt).not.toHaveBeenCalled();
    });

    it('logs a delivery it cannot attempt because the store failed', async () => {
      const { outbox, storage, warn } = await newOutbox();
      const failure = new Error('store down');
      await outbox.enqueue(delivery());
      jest.spyOn(storage, 'get').mockRejectedValue(failure);

      await advance(0);

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Delivery dlv_\S+ could not be attempted$/), failure);
    });
  });
});
