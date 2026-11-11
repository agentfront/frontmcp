import type { EventOccurrence } from '@frontmcp/protocol';
import { signingKeyOf, webhookSignatureHeaders } from '@frontmcp/utils';

import {
  createEventWebhookReceiver,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_POLL_FLOOR_MS,
  EventsClient,
  MAX_RETRY_DELAY_MS,
  NO_EXPIRY_REFRESH_MS,
} from '..';
import {
  DuplicateEventSubscriptionError,
  EventRequestError,
  EventSubscriptionTerminatedError,
  NoCompatibleDeliveryModeError,
} from '../event-client.errors';
import type { EventsClientTransport, EventsStreamNotification, EventSubscription } from '../events-client.types';

const ALL_MODES = ['poll', 'push', 'webhook'];
const FAST = { pollFloorMs: 5, heartbeatTimeoutMs: 200 };

/** An occurrence with the given id. */
function occurrenceOf(eventId: string, cursor?: string): EventOccurrence {
  return { eventId, name: 'order.created', timestamp: '2026-11-10T10:00:00Z', data: { eventId }, cursor };
}

/** A definition offered in `delivery`. */
function definitionOf(name: string, delivery = ALL_MODES) {
  return { name, delivery, inputSchema: {}, payloadSchema: {} };
}

/** The next `count` occurrences of a subscription. */
async function take(subscription: EventSubscription, count: number): Promise<EventOccurrence[]> {
  const iterator = subscription[Symbol.asyncIterator]();
  const taken: EventOccurrence[] = [];
  while (taken.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    taken.push(next.value);
  }
  return taken;
}

/** Wait until `condition` holds. */
async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 2));
}

type Responder = (params: Record<string, unknown>) => unknown;

/** A transport answering each method with its responder, recording every request. */
function transportOf(responders: Record<string, Responder>, definitions = [definitionOf('order.created')]) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const transport: EventsClientTransport = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'events/list') return { events: definitions };
      const responder = responders[method];
      if (!responder) throw new Error(`unexpected ${method}`);
      return responder(params);
    },
  };
  return { transport, calls };
}

/** A stream the test drives: each open is recorded with the function that sends its notifications. */
interface OpenedStream {
  params: Record<string, unknown>;
  send(method: string, params?: Record<string, unknown>): void;
  end(error?: unknown): void;
  signal: AbortSignal;
}

/** Give a transport an `openStream` the test drives. */
function withStreams(transport: EventsClientTransport): OpenedStream[] {
  const opened: OpenedStream[] = [];
  transport.openStream = (params, onNotification, signal) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
      opened.push({
        params,
        signal,
        send: (method, notificationParams) =>
          onNotification({ method, params: notificationParams } as EventsStreamNotification),
        end: (error) => (error ? reject(error) : resolve()),
      });
    });
  return opened;
}

const refused = (code: number) => new EventRequestError('events/poll', code, 'refused', { reason: 'test' });

describe('EventsClient', () => {
  it('polls at most once a second, waits a minute for a heartbeat, and refreshes an unexpiring grant hourly', () => {
    expect([DEFAULT_POLL_FLOOR_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS, NO_EXPIRY_REFRESH_MS, MAX_RETRY_DELAY_MS]).toEqual([
      1000, 60000, 3600000, 60000,
    ]);
  });

  describe('list', () => {
    it('reads every page and remembers the definitions', async () => {
      const pages = [{ events: [definitionOf('a')], nextCursor: 'p2' }, { events: [definitionOf('b', ['poll'])] }];
      const requests: Array<Record<string, unknown>> = [];
      const client = new EventsClient({
        async request(_method, params) {
          requests.push(params);
          return pages[requests.length - 1];
        },
      });

      const events = await client.list();

      expect(events.map((definition) => definition.name)).toEqual(['a', 'b']);
      expect(requests).toEqual([{}, { cursor: 'p2' }]);
    });
  });

  describe('mode selection', () => {
    it('picks webhook, then push, then poll, among what the event offers', async () => {
      const { transport } = transportOf({ 'events/poll': () => ({ events: [], cursor: null }) }, [
        definitionOf('order.created', ['poll']),
      ]);
      withStreams(transport);
      const client = new EventsClient(transport, FAST);

      const subscription = await client.subscribe('order.created');

      expect(subscription.mode).toBe('poll');
      await subscription.cancel();
    });

    it('assumes every usable mode for an event the server does not list', async () => {
      const { transport } = transportOf({ 'events/poll': () => ({ events: [], cursor: null }) }, []);
      const client = new EventsClient(transport, FAST);

      const subscription = await client.subscribe('hidden.event');

      expect(subscription.mode).toBe('poll');
      await subscription.cancel();
    });

    it('refuses a forced mode the client cannot use or the event does not offer', async () => {
      const { transport } = transportOf({}, [definitionOf('order.created', ['webhook'])]);
      const client = new EventsClient(transport);

      await expect(client.subscribe('order.created', {}, { delivery: 'push' })).rejects.toBeInstanceOf(
        NoCompatibleDeliveryModeError,
      );
      await expect(client.subscribe('order.created')).rejects.toThrow('this client can use poll');
    });
  });

  describe('poll', () => {
    it('drains on hasMore, waits otherwise, dedupes, and keeps the cursor', async () => {
      const results = [
        { events: [], cursor: 'c0', truncated: true },
        { events: [occurrenceOf('e1'), occurrenceOf('e2')], cursor: 'c2', hasMore: true },
        { events: [occurrenceOf('e2'), occurrenceOf('e3')], cursor: 'c3', hasMore: false, nextPollMs: 1 },
      ];
      const { transport, calls } = transportOf({
        'events/poll': () => results.shift() ?? { events: [], cursor: 'c3', nextPollMs: 60000 },
      });
      const onTruncated = jest.fn();
      const client = new EventsClient(transport, FAST);

      const subscription = await client.subscribe(
        'order.created',
        { status: 'paid' },
        { maxAgeMs: 1000, maxEvents: 2, onTruncated },
      );
      const occurrences = await take(subscription, 3);
      await subscription.cancel();

      expect(occurrences.map((occurrence) => occurrence.eventId)).toEqual(['e1', 'e2', 'e3']);
      expect(onTruncated).toHaveBeenCalledWith('c0');
      const polls = calls.filter((call) => call.method === 'events/poll').map((call) => call.params);
      expect(polls[0]).toEqual({
        name: 'order.created',
        arguments: { status: 'paid' },
        cursor: null,
        maxAgeMs: 1000,
        maxEvents: 2,
      });
      expect(polls[1]).toEqual({ name: 'order.created', arguments: { status: 'paid' }, cursor: 'c0', maxEvents: 2 });
      expect(subscription.cursor).toBe('c3');
    });

    it('starts from the stored cursor unless one is given', async () => {
      const store = { get: jest.fn().mockResolvedValue('stored'), set: jest.fn().mockRejectedValue(new Error('x')) };
      const { transport, calls } = transportOf({ 'events/poll': () => ({ events: [], cursor: 'next' }) });
      const client = new EventsClient(transport, { ...FAST, cursorStore: store });

      const first = await client.subscribe('order.created');
      const second = await client.subscribe('order.created', {}, { cursor: null });
      await Promise.all([first.cancel(), second.cancel()]);

      expect(calls.filter((call) => call.method === 'events/poll').map((call) => call.params['cursor'])).toEqual([
        'stored',
        null,
      ]);
      expect(store.get).toHaveBeenCalledWith('{"arguments":{},"name":"order.created"}');
    });

    it('retries a poll that failed, and ends the iteration with the error that refuses it', async () => {
      const outcomes: Array<() => unknown> = [
        () => ({ events: [], cursor: 'c0', nextPollMs: 0 }),
        () => {
          throw new Error('connection reset');
        },
        () => ({ events: [occurrenceOf('e1')], cursor: 'c1', nextPollMs: 0 }),
        () => {
          throw refused(-32024);
        },
      ];
      const { transport } = transportOf({ 'events/poll': () => (outcomes.shift() as () => unknown)() });
      const client = new EventsClient(transport, FAST);
      const subscription = await client.subscribe('order.created');
      const iterator = subscription[Symbol.asyncIterator]();

      const first = await iterator.next();
      const ended = iterator.next();

      expect(first.value?.eventId).toBe('e1');
      await expect(ended).rejects.toBeInstanceOf(EventSubscriptionTerminatedError);
      await expect(ended).rejects.toMatchObject({ error: { code: -32024, data: { reason: 'test' } } });
      await subscription.cancel();
    });

    it('forgets the oldest event id past its window, and reports a refusal without data as an empty one', async () => {
      const many = Array.from({ length: 1001 }, (_unused, index) => occurrenceOf(`e${index}`));
      const results: Array<() => unknown> = [
        () => ({ events: [], cursor: 'c0', nextPollMs: 0 }),
        () => ({ events: many, cursor: 'c1', nextPollMs: 0 }),
        () => ({ events: [occurrenceOf('e0')], cursor: 'c2', nextPollMs: 0 }),
        () => {
          throw new EventRequestError('events/poll', -32023, 'gone');
        },
      ];
      const { transport } = transportOf({ 'events/poll': () => (results.shift() as () => unknown)() });
      const client = new EventsClient(transport, FAST);
      const subscription = await client.subscribe('order.created');

      const occurrences = await take(subscription, 1002);
      const ended = await subscription[Symbol.asyncIterator]()
        .next()
        .catch((error: unknown) => error);

      expect(occurrences.at(-1)?.eventId).toBe('e0');
      expect(ended).toMatchObject({ error: { code: -32023, data: {} } });
    });

    it('retries ResourceExhausted and CallbackEndpointError in both dialects, waiting longer after each failure', async () => {
      const codes = [-32025, -32013, -32027, -32015];
      const pollTimes: number[] = [];
      const { transport } = transportOf({
        'events/poll': () => {
          pollTimes.push(Date.now());
          if (pollTimes.length === 1) return { events: [], cursor: 'c0', nextPollMs: 0 };
          const code = codes.shift();
          if (code !== undefined) throw new EventRequestError('events/poll', code, 'busy');
          return { events: [occurrenceOf('e1')], cursor: 'c1', nextPollMs: 60000 };
        },
      });
      const client = new EventsClient(transport, { ...FAST, pollFloorMs: 20 });
      const subscription = await client.subscribe('order.created');

      const [occurrence] = await take(subscription, 1);
      await subscription.cancel();

      expect(occurrence.eventId).toBe('e1');
      const gaps = pollTimes.slice(2).map((time, index) => time - pollTimes[index + 1]);
      expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(150);
    });

    it('keeps the events of a poll whose cursor store throws', async () => {
      const store = {
        get: () => undefined,
        set: () => {
          throw new Error('disk full');
        },
      };
      const { transport } = transportOf({
        'events/poll': () => ({ events: [occurrenceOf('e1')], cursor: 'c1', nextPollMs: 60000 }),
      });
      const client = new EventsClient(transport, { ...FAST, cursorStore: store });

      const subscription = await client.subscribe('order.created');
      const [occurrence] = await take(subscription, 1);
      await subscription.cancel();

      expect(occurrence.eventId).toBe('e1');
      expect(subscription.cursor).toBe('c1');
    });

    it('cancels every subscription it holds on close', async () => {
      const { transport, calls } = transportOf({
        'events/poll': () => ({ events: [], cursor: 'c', nextPollMs: 0 }),
      });
      const client = new EventsClient(transport, FAST);
      const first = await client.subscribe('order.created', { n: 1 });
      const second = await client.subscribe('order.created', { n: 2 });
      await first.cancel();

      await client.close();
      const pollsAtClose = calls.length;
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(calls.length).toBe(pollsAtClose);
      await expect(second[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
    });

    it('rejects subscribe when the first poll is refused', async () => {
      const { transport } = transportOf({
        'events/poll': () => {
          throw new EventRequestError('events/poll', -32602, 'bad arguments', 'not an object');
        },
      });
      const client = new EventsClient(transport, FAST);

      await expect(client.subscribe('order.created')).rejects.toMatchObject({ rpcCode: -32602 });
    });

    it('cancels when the consumer leaves the iteration', async () => {
      const { transport, calls } = transportOf({
        'events/poll': () => ({ events: [occurrenceOf('e1'), occurrenceOf('e2')], cursor: 'c', nextPollMs: 0 }),
      });
      const client = new EventsClient(transport, FAST);
      const subscription = await client.subscribe('order.created');

      for await (const occurrence of subscription) {
        expect(occurrence.eventId).toBe('e1');
        break;
      }
      const pollsAtBreak = calls.length;
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(calls.length).toBe(pollsAtBreak);
      await expect(subscription[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
    });
  });

  describe('push', () => {
    it('resolves on active, yields events, and keeps the cursor of heartbeats', async () => {
      const { transport } = transportOf({});
      const streams = withStreams(transport);
      const onTruncated = jest.fn();
      const onError = jest.fn();
      const client = new EventsClient(transport, FAST);

      const subscribing = client.subscribe('order.created', { a: 1 }, { onTruncated, onError, maxAgeMs: 5 });
      await until(() => streams.length === 1);
      streams[0].send('notifications/events/active', { cursor: 'c0', truncated: true, _meta: {} });
      const subscription = await subscribing;
      streams[0].send('notifications/events/event', { ...occurrenceOf('e1', 'c1'), _meta: { id: 1 } });
      streams[0].send('notifications/events/event', { eventId: 'broken' });
      streams[0].send('notifications/events/error', { error: { code: -32603, message: 'Upstream 503' } });
      streams[0].send('notifications/events/error', { error: 'not an error' });
      streams[0].send('notifications/events/unknown');
      const [occurrence] = await take(subscription, 1);
      streams[0].send('notifications/events/heartbeat', { cursor: 'c2' });

      expect(subscription.mode).toBe('push');
      expect(streams[0].params).toEqual({ name: 'order.created', arguments: { a: 1 }, cursor: null, maxAgeMs: 5 });
      expect(occurrence).toEqual(occurrenceOf('e1', 'c1'));
      expect(onTruncated).toHaveBeenCalledWith('c0');
      expect(onError).toHaveBeenCalledWith({ code: -32603, message: 'Upstream 503' });
      expect(subscription.cursor).toBe('c2');
      await subscription.cancel();
      expect(streams[0].signal.aborted).toBe(true);
    });

    it('rejects subscribe when the stream is refused, or ends before it is confirmed', async () => {
      const { transport } = transportOf({});
      const streams = withStreams(transport);
      const client = new EventsClient(transport, FAST);

      const refusedStream = client.subscribe('order.created').catch((error: unknown) => error);
      await until(() => streams.length === 1);
      streams[0].end(refused(-32023));
      const endedStream = client.subscribe('order.created').catch((error: unknown) => error);
      await until(() => streams.length === 2);
      streams[1].end();

      await expect(refusedStream).resolves.toMatchObject({ rpcCode: -32023 });
      await expect(endedStream).resolves.toMatchObject({ message: expect.stringContaining('before the server') });
    });

    it('reconnects from its cursor when the stream ends or falls silent', async () => {
      const { transport } = transportOf({});
      const streams = withStreams(transport);
      const client = new EventsClient(transport, { pollFloorMs: 5, heartbeatTimeoutMs: 60 });

      const subscribing = client.subscribe('order.created');
      await until(() => streams.length === 1);
      streams[0].send('notifications/events/active', { cursor: 'c0' });
      const subscription = await subscribing;
      streams[0].end();
      await until(() => streams.length === 2);
      streams[1].end(new Error('network'));
      await until(() => streams.length === 3);
      streams[2].send('notifications/events/active', { cursor: 'c5' });
      await until(() => streams.length === 4);

      expect(streams[1].params['cursor']).toBe('c0');
      expect(streams[3].params['cursor']).toBe('c5');
      expect(streams[2].signal.aborted).toBe(true);
      await subscription.cancel();
    });

    it('keeps reconnecting while the server answers ResourceExhausted', async () => {
      const { transport } = transportOf({});
      const streams = withStreams(transport);
      const client = new EventsClient(transport, FAST);

      const subscribing = client.subscribe('order.created');
      await until(() => streams.length === 1);
      streams[0].send('notifications/events/active', { cursor: 'c0' });
      const subscription = await subscribing;
      streams[0].end();
      await until(() => streams.length === 2);
      streams[1].end(new EventRequestError('events/stream', -32025, 'limit'));
      await until(() => streams.length === 3);
      streams[2].send('notifications/events/active', { cursor: 'c1' });
      streams[2].send('notifications/events/event', occurrenceOf('e1', 'c2'));

      await expect(take(subscription, 1)).resolves.toEqual([occurrenceOf('e1', 'c2')]);
      await subscription.cancel();
    });

    it('ends the iteration on terminated, and on a reconnection the server refuses', async () => {
      const { transport } = transportOf({});
      const streams = withStreams(transport);
      const client = new EventsClient(transport, FAST);

      const first = client.subscribe('order.created', { n: 1 });
      await until(() => streams.length === 1);
      streams[0].send('notifications/events/active', { cursor: null });
      const terminated = await first;
      streams[0].send('notifications/events/terminated', { error: { code: -32024, message: 'Forbidden' } });

      const second = client.subscribe('order.created', { n: 2 });
      await until(() => streams.length === 2);
      streams[1].send('notifications/events/active', {});
      const refusedOnReconnect = await second;
      streams[1].end();
      await until(() => streams.length === 3);
      streams[2].end(refused(-32024));

      await expect(take(terminated, 1)).rejects.toMatchObject({ error: { code: -32024, message: 'Forbidden' } });
      await expect(take(refusedOnReconnect, 1)).rejects.toBeInstanceOf(EventSubscriptionTerminatedError);
      await terminated.cancel();
    });
  });

  describe('webhook', () => {
    const URL = 'https://hooks.example.com/mcp';

    /** A client with a webhook receiver over a transport answering subscribe with `answer`. */
    function webhookClient(answer: Responder, unsubscribe: Responder = () => ({})) {
      const receiver = createEventWebhookReceiver();
      const { transport, calls } = transportOf({ 'events/subscribe': answer, 'events/unsubscribe': unsubscribe });
      const client = new EventsClient(transport, { ...FAST, webhook: { url: URL, receiver, ttlMs: 60000 } });
      return { client, receiver, calls };
    }

    /** A delivery to the receiver, signed with the secret the subscription sent. */
    function delivery(body: unknown, secret: string, webhookId: string) {
      const rawBody = JSON.stringify(body);
      return {
        headers: {
          'x-mcp-subscription-id': 'sub_1',
          ...webhookSignatureHeaders({ id: webhookId, timestamp: Math.floor(Date.now() / 1000), body: rawBody }, [
            signingKeyOf(secret),
          ]),
        },
        rawBody,
      };
    }

    it('subscribes with a generated secret, receives deliveries and gaps, and unsubscribes on cancel', async () => {
      const onTruncated = jest.fn();
      const { client, receiver, calls } = webhookClient(() => ({
        id: 'sub_1',
        refreshBefore: null,
        cursor: 'w0',
        deliveryStatus: { active: true },
      }));

      const subscription = await client.subscribe('order.created', { a: 1 }, { onTruncated });
      const secret = (calls[1].params['delivery'] as { secret: string }).secret;
      const answered = await receiver.handle(delivery(occurrenceOf('e1', 'w1'), secret, 'msg_1'));
      await receiver.handle(delivery({ type: 'gap', cursor: 'w9' }, secret, 'msg_gap_1'));
      const [occurrence] = await take(subscription, 1);
      await subscription.cancel();

      expect(subscription.mode).toBe('webhook');
      expect(subscription.id).toBe('sub_1');
      expect(subscription.deliveryStatus).toEqual({ active: true });
      expect(secret).toMatch(/^whsec_/);
      expect(calls[1].params).toMatchObject({ delivery: { mode: 'webhook', url: URL }, ttlMs: 60000, cursor: null });
      expect(answered.status).toBe(200);
      expect(occurrence.eventId).toBe('e1');
      expect(onTruncated).toHaveBeenCalledWith('w9');
      expect(calls[2]).toEqual({
        method: 'events/unsubscribe',
        params: { name: 'order.created', arguments: { a: 1 }, delivery: { mode: 'webhook', url: URL } },
      });
      expect(receiver.hasSecrets()).toBe(false);
    });

    it('refreshes before refreshBefore with the same secret and the latest cursor', async () => {
      let count = 0;
      const { client, calls } = webhookClient(() => {
        count += 1;
        if (count === 2) throw new Error('timeout');
        return { id: 'sub_1', refreshBefore: new Date(Date.now() + 20).toISOString(), cursor: `w${count}` };
      });

      const subscription = await client.subscribe('order.created');
      await until(() => count >= 3);
      await subscription.cancel();

      const secrets = calls
        .filter((call) => call.method === 'events/subscribe')
        .map((call) => (call.params['delivery'] as { secret: string }).secret);
      expect(new Set(secrets).size).toBe(1);
      expect(calls.filter((call) => call.method === 'events/subscribe')[2].params['cursor']).toBe('w1');
    });

    it('ends the iteration on a terminated envelope and on a refused refresh', async () => {
      const { client, receiver, calls } = webhookClient((params) => {
        if ((params['arguments'] as { n: number }).n === 2 && calls.length > 3) throw refused(-32024);
        return { id: 'sub_1', refreshBefore: new Date(Date.now() + 10).toISOString() };
      });

      const enveloped = await client.subscribe('order.created', { n: 1 });
      const secret = (calls[1].params['delivery'] as { secret: string }).secret;
      await receiver.handle(
        delivery({ type: 'terminated', error: { code: -32024, message: 'Forbidden' } }, secret, 'msg_t_1'),
      );
      const refreshRefused = await client.subscribe('order.created', { n: 2 });

      await expect(take(enveloped, 1)).rejects.toBeInstanceOf(EventSubscriptionTerminatedError);
      await expect(take(refreshRefused, 1)).rejects.toMatchObject({ error: { code: -32024 } });
    });

    it('releases the secret when the first subscribe is refused', async () => {
      const { client, receiver } = webhookClient(() => {
        throw new EventRequestError('events/subscribe', -32027, 'challenge failed', { reason: 'challenge_failed' });
      });

      await expect(client.subscribe('order.created')).rejects.toMatchObject({ rpcCode: -32027 });
      expect(receiver.hasSecrets()).toBe(false);
    });

    it('asks for the server default lifetime when no ttlMs is configured', async () => {
      const receiver = createEventWebhookReceiver();
      const { transport, calls } = transportOf({
        'events/subscribe': () => ({ id: 'sub_1', refreshBefore: null }),
        'events/unsubscribe': () => ({}),
      });
      const client = new EventsClient(transport, { webhook: { url: URL, receiver } });

      const subscription = await client.subscribe('order.created');
      await subscription.cancel();

      expect(calls[1].params).not.toHaveProperty('ttlMs');
    });

    it('retries a refresh the callback endpoint failed', async () => {
      let count = 0;
      const { client } = webhookClient(() => {
        count += 1;
        if (count === 2) throw new EventRequestError('events/subscribe', -32027, 'unreachable', { reason: 'timeout' });
        return { id: 'sub_1', refreshBefore: new Date(Date.now() + 10).toISOString() };
      });

      const subscription = await client.subscribe('order.created');
      await until(() => count >= 3);
      await subscription.cancel();

      expect(count).toBeGreaterThanOrEqual(3);
    });

    it.each([
      ['a grant past the longest timer', () => new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString()],
      ['a refreshBefore that is not a date', () => 'soon'],
    ])('does not refresh at once for %s', async (_label, refreshBefore) => {
      let count = 0;
      const { client } = webhookClient(() => {
        count += 1;
        return { id: 'sub_1', refreshBefore: refreshBefore() };
      });

      const subscription = await client.subscribe('order.created');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await subscription.cancel();

      expect(count).toBe(1);
    });

    it('unsubscribes a webhook subscription when the client closes', async () => {
      const { client, calls } = webhookClient(() => ({ id: 'sub_1', refreshBefore: null }));
      await client.subscribe('order.created');

      await client.close();

      expect(calls.at(-1)?.method).toBe('events/unsubscribe');
    });

    it('sends events/unsubscribe only after an events/subscribe in flight has been answered', async () => {
      const order: string[] = [];
      const answers: Array<() => void> = [];
      const { client } = webhookClient(
        () => {
          order.push('subscribe sent');
          return new Promise((resolve) =>
            answers.push(() => {
              order.push('subscribe answered');
              resolve({ id: 'sub_1', refreshBefore: new Date(Date.now() + 10).toISOString() });
            }),
          );
        },
        () => {
          order.push('unsubscribe sent');
          return {};
        },
      );

      const subscribing = client.subscribe('order.created');
      await until(() => answers.length === 1);
      answers[0]();
      const subscription = await subscribing;
      await until(() => answers.length === 2);
      const cancelling = subscription.cancel();
      await new Promise((resolve) => setTimeout(resolve, 20));
      answers[1]();
      await cancelling;

      const closing = webhookClient(
        () => new Promise((resolve) => answers.push(() => resolve({ id: 'sub_2', refreshBefore: null }))),
      );
      const firstSubscribe = closing.client.subscribe('order.created');
      await until(() => answers.length === 3);
      const closed = closing.client.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const unsubscribedEarly = closing.calls.some((call) => call.method === 'events/unsubscribe');
      answers[2]();
      await Promise.all([closed, firstSubscribe]);

      expect(order).toEqual([
        'subscribe sent',
        'subscribe answered',
        'subscribe sent',
        'subscribe answered',
        'unsubscribe sent',
      ]);
      expect(unsubscribedEarly).toBe(false);
      expect(closing.calls.at(-1)?.method).toBe('events/unsubscribe');
    });

    it('refuses a second webhook subscription to the same event and arguments, also when both are made at once', async () => {
      const { client, calls } = webhookClient(() => ({ id: 'sub_1', refreshBefore: null }));

      const results = await Promise.allSettled([
        client.subscribe('order.created', { a: 1, b: 2 }),
        client.subscribe('order.created', { b: 2, a: 1 }),
      ]);
      const later = await client.subscribe('order.created', { a: 1, b: 2 }).catch((error: unknown) => error);
      const first = results.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<EventSubscription>;
      await first.value.cancel();
      const afterCancel = await client.subscribe('order.created', { a: 1, b: 2 });
      await afterCancel.cancel();

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        DuplicateEventSubscriptionError,
      );
      expect(later).toBeInstanceOf(DuplicateEventSubscriptionError);
      expect(calls.filter((call) => call.method === 'events/subscribe')).toHaveLength(2);
    });

    it('refuses a subscription the server gives the id of one the client holds, and gives the holder its secret back', async () => {
      const { client, receiver, calls } = webhookClient(() => ({ id: 'sub_1', refreshBefore: null }));
      const holder = await client.subscribe('order.created', { status: 'paid' });
      const holderSecret = (calls[1].params['delivery'] as { secret: string }).secret;

      const duplicate = await client
        .subscribe('order.created', { status: 'paid', note: null })
        .catch((error: unknown) => error);
      await until(() => calls.filter((call) => call.method === 'events/subscribe').length === 3);
      await receiver.handle(delivery(occurrenceOf('e1'), holderSecret, 'msg_1'));
      const [occurrence] = await take(holder, 1);

      const subscribes = calls.filter((call) => call.method === 'events/subscribe');
      expect(duplicate).toBeInstanceOf(DuplicateEventSubscriptionError);
      expect((subscribes[2].params['delivery'] as { secret: string }).secret).toBe(holderSecret);
      expect(calls.some((call) => call.method === 'events/unsubscribe')).toBe(false);
      expect(occurrence.eventId).toBe('e1');
      await holder.cancel();
    });

    /** A client whose holder answers its first subscribe at once and holds every later one until answered. */
    function heldRefreshClient() {
      const order: string[] = [];
      const answers: Array<() => void> = [];
      let holderSubscribes = 0;
      const { client, calls } = webhookClient(
        (params) => {
          if ('note' in (params['arguments'] as Record<string, unknown>)) return { id: 'sub_1', refreshBefore: null };
          holderSubscribes += 1;
          const call = holderSubscribes;
          order.push(`subscribe ${call} sent`);
          if (call === 1) return { id: 'sub_1', refreshBefore: new Date(Date.now() + 10).toISOString() };
          return new Promise((resolve) =>
            answers.push(() => {
              order.push(`subscribe ${call} answered`);
              resolve({ id: 'sub_1', refreshBefore: null });
            }),
          );
        },
        () => {
          order.push('unsubscribe sent');
          return {};
        },
      );
      const holderSubscribesSent = () => holderSubscribes;
      return { client, calls, order, answers, holderSubscribesSent };
    }

    it('sends the refresh a duplicate asks of its holder only after the holder refresh in flight is answered', async () => {
      const { client, calls, order, answers, holderSubscribesSent } = heldRefreshClient();
      const holder = await client.subscribe('order.created', { status: 'paid' });
      const holderSecret = (calls[1].params['delivery'] as { secret: string }).secret;
      await until(() => answers.length === 1);

      const duplicate = await client
        .subscribe('order.created', { status: 'paid', note: null })
        .catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const sentWhileInFlight = holderSubscribesSent();
      answers[0]();
      await until(() => answers.length === 2);
      answers[1]();
      await until(() => order.includes('subscribe 3 answered'));
      await holder.cancel();

      const holderSubscribeCalls = calls.filter(
        (call) => call.method === 'events/subscribe' && !('note' in (call.params['arguments'] as object)),
      );
      expect(duplicate).toBeInstanceOf(DuplicateEventSubscriptionError);
      expect(sentWhileInFlight).toBe(2);
      expect((holderSubscribeCalls[2].params['delivery'] as { secret: string }).secret).toBe(holderSecret);
      expect(order).toEqual([
        'subscribe 1 sent',
        'subscribe 2 sent',
        'subscribe 2 answered',
        'subscribe 3 sent',
        'subscribe 3 answered',
        'unsubscribe sent',
      ]);
    });

    it('unsubscribes a holder only after both its refresh in flight and the one a duplicate asked for', async () => {
      const { client, order, answers } = heldRefreshClient();
      const holder = await client.subscribe('order.created', { status: 'paid' });
      await until(() => answers.length === 1);
      await client.subscribe('order.created', { status: 'paid', note: null }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const cancelling = holder.cancel();
      while (answers.length > 0) {
        (answers.pop() as () => void)();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await cancelling;

      expect(order.at(-1)).toBe('unsubscribe sent');
    });

    it('ignores a failed unsubscribe', async () => {
      const { client } = webhookClient(
        () => ({ id: 'sub_1', refreshBefore: null }),
        () => {
          throw new Error('gone');
        },
      );
      const subscription = await client.subscribe('order.created');

      await expect(subscription.cancel()).resolves.toBeUndefined();
      await expect(subscription.cancel()).resolves.toBeUndefined();
    });
  });
});
