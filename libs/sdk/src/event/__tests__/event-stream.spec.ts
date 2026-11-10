import { type EventContext, type EventEntry } from '../../common';
import { EventBuffer } from '../poll/event-buffer';
import {
  EventStream,
  MAX_QUEUED_NOTIFICATIONS,
  type EventStreamNotification,
  type EventStreamOptions,
} from '../stream/event-stream';

const NOW = 1_800_000_000_000;
const META = { 'io.modelcontextprotocol/subscriptionId': 7 };
const HEARTBEAT_MS = 25_000;
const accessRevoked = { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } };

function occurrence(id: string, status = 'paid') {
  return { eventId: id, name: 'order.created', timestamp: new Date(NOW).toISOString(), data: { status } };
}

interface Harness {
  stream: EventStream;
  buffer: EventBuffer;
  received: EventStreamNotification[];
  warn: jest.Mock;
  isStillAuthorized: jest.Mock;
  abort: () => void;
}

function openable(context: Partial<EventContext> = {}, overrides: Partial<EventStreamOptions> = {}): Harness {
  const buffer = new EventBuffer({ maxAgeMs: 600_000, maxEvents: 100 });
  const controller = new AbortController();
  const warn = jest.fn();
  const isStillAuthorized = jest.fn().mockResolvedValue(true);
  const event = {
    name: 'order.created',
    parsePayload: (data: { status?: unknown }) => {
      if (typeof data.status !== 'string') throw new Error('status must be a string');
      return data;
    },
  } as unknown as EventEntry;
  const stream = new EventStream({
    requestId: 7,
    event,
    context: context as EventContext,
    reader: {
      principalKey: 'principal:ada',
      subscriber: { sub: 'ada', roles: ['admin'], permissions: [], scopes: [], claims: {} },
    },
    subscription: {
      id: 'sub_stream',
      name: 'order.created',
      mode: 'push',
      subscriber: { sub: 'ada', roles: ['admin'], permissions: [], scopes: [], claims: {} },
    },
    arguments: { status: 'paid' },
    cursor: null,
    maxAgeMs: undefined,
    buffer: context.check ? undefined : buffer,
    heartbeatMs: HEARTBEAT_MS,
    checkIntervalMs: 30_000,
    checkMaxEvents: 100,
    reauthorizeEveryMs: 300_000,
    isStillAuthorized,
    accessRevoked,
    signal: controller.signal,
    logger: { warn } as never,
    ...overrides,
  });
  const received: EventStreamNotification[] = [];
  void (async () => {
    for await (const notification of stream) received.push(notification);
  })();
  return { stream, buffer, received, warn, isStillAuthorized, abort: () => controller.abort() };
}

async function settle(ms = 0): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

function methodsOf(received: EventStreamNotification[]): string[] {
  return received.map((notification) => notification.method.replace('notifications/events/', ''));
}

describe('EventStream', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('of a published event', () => {
    it('confirms with active and the current cursor, tagged with the id of the request', async () => {
      const { stream, buffer, received } = openable();
      buffer.append(occurrence('evt_before'));

      await stream.open();
      await settle();

      expect(received).toEqual([
        {
          method: 'notifications/events/active',
          params: { cursor: buffer.currentCursor(), truncated: false, _meta: META },
        },
      ]);
      expect(stream.eventName).toBe('order.created');
      expect(stream.principalKey).toBe('principal:ada');
      expect(stream.subscription.id).toBe('sub_stream');
    });

    it('delivers an occurrence that is offered, with the cursor after it', async () => {
      const { stream, buffer, received } = openable();
      await stream.open();

      await stream.offer(buffer.append(occurrence('evt_1')));
      await settle();

      expect(received[1]).toEqual({
        method: 'notifications/events/event',
        params: { ...occurrence('evt_1'), cursor: buffer.cursorAt(1), _meta: META },
      });
    });

    it('filters by a targeted subscription, the audience, match() and shapes with transform()', async () => {
      const match = jest.fn((event: { data: { status?: string } }, args: { status?: string }) => {
        if (event.data.status === 'explode') throw new Error('match failed');
        return event.data.status === args.status;
      });
      const transform = jest.fn((event: object) => ({ ...event, data: { status: 'paid', shaped: true } }));
      const { stream, buffer, received, warn } = openable({ match, transform } as never);
      await stream.open();

      await stream.offer(buffer.append(occurrence('evt_other_sub'), undefined, 'sub_another'));
      await stream.offer(buffer.append(occurrence('evt_audience'), { roles: { any: ['member'] } }));
      await stream.offer(buffer.append(occurrence('evt_unmatched', 'refunded')));
      await stream.offer(buffer.append(occurrence('evt_failing', 'explode')));
      await stream.offer(buffer.append(occurrence('evt_mine'), { roles: { any: ['admin'] } }, 'sub_stream'));
      await settle();

      expect(received.slice(1).map((notification) => notification.params['eventId'])).toEqual(['evt_mine']);
      expect(received[1].params['data']).toEqual({ status: 'paid', shaped: true });
      expect(warn).toHaveBeenCalledWith('Event "order.created" failed for stream sub_stream', expect.any(Error));
    });

    it('replays what was published after the cursor of the request, then continues live', async () => {
      const first = openable();
      const cursor = first.buffer.currentCursor();
      first.buffer.append(occurrence('evt_1'));
      first.buffer.append(occurrence('evt_2', 'refunded'));
      const replaying = new EventStream({
        ...(first.stream as unknown as { options: EventStreamOptions }).options,
        cursor,
        signal: undefined,
      });
      const received: EventStreamNotification[] = [];
      void (async () => {
        for await (const notification of replaying) received.push(notification);
      })();

      await replaying.open();
      await replaying.offer(first.buffer.append(occurrence('evt_3')));
      await settle();

      expect(methodsOf(received)).toEqual(['active', 'event', 'event', 'event']);
      expect(received[0].params).toMatchObject({ cursor, truncated: false });
      expect(received.slice(1).map((notification) => notification.params['eventId'])).toEqual([
        'evt_1',
        'evt_2',
        'evt_3',
      ]);
      replaying.close();
    });

    it('confirms with truncated when the cursor cannot be placed, or maxAgeMs skipped something', async () => {
      const unplaceable = openable({}, { cursor: 'another-process.4' });
      await unplaceable.stream.open();

      const aged = openable();
      const cursor = aged.buffer.currentCursor();
      aged.buffer.append(occurrence('evt_old'));
      jest.setSystemTime(NOW + 120_000);
      aged.buffer.append(occurrence('evt_new'));
      const bounded = new EventStream({
        ...(aged.stream as unknown as { options: EventStreamOptions }).options,
        cursor,
        maxAgeMs: 60_000,
        signal: undefined,
      });
      const received: EventStreamNotification[] = [];
      void (async () => {
        for await (const notification of bounded) received.push(notification);
      })();
      await bounded.open();
      await settle();

      expect(unplaceable.received[0].params).toMatchObject({ truncated: true });
      expect(received[0].params).toMatchObject({ truncated: true });
      expect(received.slice(1).map((notification) => notification.params['eventId'])).toEqual(['evt_new']);
      bounded.close();
    });

    it('opens without a buffer, with no cursor to give', async () => {
      const { stream, received } = openable({}, { buffer: undefined });

      await stream.open();
      await settle();

      expect(received[0].params).toMatchObject({ cursor: null, truncated: false });
    });
  });

  describe('heartbeat and access', () => {
    it('sends a heartbeat with the cursor at each interval', async () => {
      const { stream, buffer, received } = openable();
      await stream.open();
      await stream.offer(buffer.append(occurrence('evt_1')));

      await settle(HEARTBEAT_MS * 2);

      expect(methodsOf(received)).toEqual(['active', 'event', 'heartbeat', 'heartbeat']);
      expect(received[2]).toEqual({
        method: 'notifications/events/heartbeat',
        params: { cursor: buffer.cursorAt(1), _meta: META },
      });
    });

    it('checks the access of its reader again once reauthorizeEveryMs passed, and ends when it is lost', async () => {
      const { stream, received, isStillAuthorized } = openable();
      await stream.open();

      await settle(300_000);
      expect(isStillAuthorized).not.toHaveBeenCalled();

      isStillAuthorized.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await settle(HEARTBEAT_MS);
      expect(isStillAuthorized).toHaveBeenCalledTimes(1);
      expect(stream.isClosed).toBe(false);

      await settle(325_000);
      expect(received[received.length - 1]).toEqual({
        method: 'notifications/events/terminated',
        params: { error: accessRevoked, _meta: META },
      });
      expect(stream.isClosed).toBe(true);
    });

    it('keeps the stream open when the access check itself fails', async () => {
      const { stream, isStillAuthorized } = openable();
      isStillAuthorized.mockRejectedValue(new Error('policy store down'));
      await stream.open();

      await settle(325_000);

      expect(stream.isClosed).toBe(false);
    });
  });

  describe('of an event with check()', () => {
    it('asks check() for the position, confirms with it, and asks again at each interval', async () => {
      const check = jest
        .fn()
        .mockResolvedValueOnce({ events: [], cursor: '5' })
        .mockResolvedValueOnce({ events: [{ data: { status: 'paid' } }], cursor: '6', nextPollMs: 1000 })
        .mockResolvedValue({ events: [], cursor: '6' });
      const { stream, received } = openable({ check });

      await stream.open();
      await settle(30_000);
      await settle(1000);

      expect(check).toHaveBeenNthCalledWith(1, { status: 'paid' }, null, { maxEvents: 100 });
      expect(check).toHaveBeenNthCalledWith(2, { status: 'paid' }, '5', { maxEvents: 100 });
      expect(check).toHaveBeenCalledTimes(3);
      expect(received[0].params).toMatchObject({ cursor: '5', truncated: false });
      expect(received.find((notification) => notification.method.endsWith('/event'))?.params).toMatchObject({
        eventId: expect.stringMatching(/^evt_/),
        name: 'order.created',
        data: { status: 'paid' },
        cursor: '6',
      });
    });

    it('replays from the cursor of the request with its maxAgeMs, and asks again at once when there is more', async () => {
      const check = jest
        .fn()
        .mockResolvedValueOnce({ events: [{ data: { status: 'paid' }, eventId: 'evt_a' }], cursor: '2', hasMore: true })
        .mockResolvedValueOnce({ events: [{ data: { status: 'paid' }, eventId: 'evt_b' }], cursor: '3' })
        .mockResolvedValue({ events: [], cursor: '3' });
      const { stream, received } = openable({ check }, { cursor: '1', maxAgeMs: 60_000 });

      await stream.open();
      await settle(30_000);
      await settle(0);

      expect(check).toHaveBeenNthCalledWith(1, { status: 'paid' }, '1', { maxEvents: 100, maxAgeMs: 60_000 });
      expect(received.filter((n) => n.method.endsWith('/event')).map((n) => n.params['eventId'])).toEqual([
        'evt_a',
        'evt_b',
      ]);
    });

    it('reports a check() that throws as an error on the stream, which stays open', async () => {
      const check = jest
        .fn()
        .mockResolvedValueOnce({ events: [], cursor: '5' })
        .mockRejectedValueOnce(new Error('upstream 503'))
        .mockResolvedValue({ events: [], cursor: '5' });
      const { stream, received, warn } = openable({ check });

      await stream.open();
      await settle(30_000);
      await settle(30_000);

      expect(received.find((notification) => notification.method.endsWith('/error'))).toEqual({
        method: 'notifications/events/error',
        params: { error: { code: -32603, message: 'UpstreamError', data: { reason: 'check() failed' } }, _meta: META },
      });
      expect(stream.isClosed).toBe(false);
      expect(check).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledWith(
        'check() of event "order.created" failed for stream sub_stream',
        expect.any(Error),
      );
    });

    it('confirms again with truncated when check() reports a gap, and leaves out data that is not the payload', async () => {
      const check = jest
        .fn()
        .mockResolvedValueOnce({ events: [], cursor: '5' })
        .mockResolvedValue({
          events: [{ data: { status: 7 } }, { data: { status: 'paid' } }],
          cursor: '9',
          truncated: true,
        });
      const { stream, received, warn } = openable({ check });

      await stream.open();
      await settle(30_000);

      const withoutHeartbeats = received.filter((notification) => !notification.method.endsWith('/heartbeat'));
      expect(methodsOf(withoutHeartbeats)).toEqual(['active', 'active', 'event']);
      expect(withoutHeartbeats[1].params).toMatchObject({ cursor: '9', truncated: true });
      expect(warn).toHaveBeenCalledWith(
        'check() of event "order.created" returned data that is not its payload',
        expect.any(Error),
      );
    });

    it('opens with an error when the first check() fails', async () => {
      const check = jest
        .fn()
        .mockRejectedValueOnce(new Error('upstream 503'))
        .mockResolvedValue({ events: [], cursor: '1' });
      const { stream, received } = openable({ check });

      await stream.open();
      await settle();

      expect(methodsOf(received)).toEqual(['error', 'active']);
    });
  });

  describe('ending', () => {
    it('ends with terminated and the reason when the server ends it', async () => {
      const { stream, received } = openable();
      await stream.open();

      stream.terminate(accessRevoked);
      stream.terminate(accessRevoked);
      await settle(HEARTBEAT_MS);

      expect(methodsOf(received)).toEqual(['active', 'terminated']);
      expect(stream.isClosed).toBe(true);
    });

    it('ends when the request is cancelled, and tells who listens once', async () => {
      const { stream, buffer, received, abort } = openable();
      const closed = jest.fn();
      await stream.open();
      stream.onClose(closed);

      abort();
      stream.close();
      await stream.offer(buffer.append(occurrence('evt_late')));
      await settle(HEARTBEAT_MS);

      expect(closed).toHaveBeenCalledTimes(1);
      expect(methodsOf(received)).toEqual(['active']);
      const late = jest.fn();
      stream.onClose(late);
      expect(late).toHaveBeenCalledTimes(1);
    });

    it('is closed from the start when the request was already cancelled, and starts no timer', async () => {
      const controller = new AbortController();
      controller.abort();
      const { stream, received } = openable({}, { signal: controller.signal });

      await stream.open();
      await settle(HEARTBEAT_MS);

      expect(stream.isClosed).toBe(true);
      expect(received).toEqual([]);
    });

    it('stops the check() loop when it ends', async () => {
      const check = jest.fn().mockResolvedValue({ events: [], cursor: '1' });
      const { stream } = openable({ check });
      await stream.open();

      stream.close();
      await settle(120_000);

      expect(check).toHaveBeenCalledTimes(1);
    });
  });

  it('replaces a queue a slow client let fill up by one confirmation with truncated', async () => {
    const buffer = new EventBuffer({ maxAgeMs: 600_000, maxEvents: 5000 });
    const { stream } = openable({}, { buffer });
    const unread = new EventStream({
      ...(stream as unknown as { options: EventStreamOptions }).options,
      signal: undefined,
    });
    await unread.open();

    for (let index = 0; index <= MAX_QUEUED_NOTIFICATIONS; index++) {
      await unread.offer(buffer.append(occurrence(`evt_${index}`)));
    }
    const queued: EventStreamNotification[] = [];
    unread.close();
    for await (const notification of unread) queued.push(notification);

    expect(queued).toHaveLength(3);
    expect(queued[0]).toMatchObject({ method: 'notifications/events/active', params: { truncated: true } });
    expect(queued[2].params['eventId']).toBe(`evt_${MAX_QUEUED_NOTIFICATIONS}`);
  });
});
