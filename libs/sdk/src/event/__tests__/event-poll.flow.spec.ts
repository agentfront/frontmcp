import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type PollEventsResult } from '@frontmcp/protocol';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  event,
  Plugin,
  type EventCheckLimits,
  type EventType,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '../../common';
import {
  EventForbiddenError,
  EventNotFoundError,
  EventResourceExhaustedError,
  EventUnsupportedError,
  InvalidEventPublishError,
  InvalidInputError,
  PublicMcpError,
} from '../../errors';
import { EventPollHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { type EventPollLeases } from '../poll/event-poll-leases';

const orderPayload = { orderId: z.string(), status: z.string(), note: z.string().optional() };
const ada = { sessionId: 'ada-session', user: { sub: 'ada', iss: 'https://auth.example.com', roles: ['admin'] } };
const bob = { sessionId: 'bob-session', user: { sub: 'bob', iss: 'https://auth.example.com', roles: ['member'] } };
const asAda = { authInfo: ada, surface: 'mcp' };
const asBob = { authInfo: bob, surface: 'mcp' };
const anonymously = { surface: 'mcp' };

const onSubscribe = jest.fn();
const onUnsubscribe = jest.fn();
const authorize = jest.fn();

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional() },
  payloadSchema: orderPayload,
  authorize,
  onSubscribe,
  onUnsubscribe,
  match(occurrence, args) {
    if (occurrence.data.status === 'explode') throw new Error('match failed');
    return args.status === undefined || args.status === occurrence.data.status;
  },
  transform(occurrence, _args, subscriber) {
    return { ...occurrence, data: { ...occurrence.data, note: `for ${subscriber.sub || 'anyone'}` } };
  },
});
const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });
const auditLogged = event({ name: 'audit.logged', payloadSchema: { action: z.string() }, authorities: 'admin' });
const webhookOnly = event({ name: 'webhook.only', payloadSchema: { id: z.string() }, delivery: ['webhook'] });
const agentNote = event({
  name: 'agent.note',
  payloadSchema: { id: z.string() },
  availableWhen: { surface: ['agent'] },
});

interface Ticket {
  id: string;
  at?: string;
}
const tickets: Ticket[] = [];
const checkCalls = jest.fn();

const ticketUpdated = event({
  name: 'ticket.updated',
  inputSchema: { queue: z.string().optional() },
  payloadSchema: { ticketId: z.string() },
  onSubscribe,
  check(args, cursor, limits?: EventCheckLimits) {
    checkCalls(args, cursor, limits);
    if (cursor === null) return { events: [], cursor: String(tickets.length), nextPollMs: 600_000 };
    const position = Number(cursor);
    const batch = tickets.slice(position, position + (limits?.maxEvents ?? tickets.length));
    return {
      events: batch.map((ticket) => ({
        data: { ticketId: ticket.id },
        ...(ticket.at && { eventId: `evt_ticket_${ticket.id}`, timestamp: ticket.at }),
      })),
      cursor: String(position + batch.length),
      hasMore: position + batch.length < tickets.length,
      truncated: position > tickets.length,
    };
  },
});

const brokenCheck = event({
  name: 'broken.check',
  payloadSchema: { ticketId: z.string() },
  check: () => ({ events: [{ data: { ticketId: 7 } as never }], cursor: '1' }),
});

const greedyCheck = event({
  name: 'greedy.check',
  payloadSchema: { ticketId: z.string() },
  check: () => ({ events: [{ data: { ticketId: 'a' } }, { data: { ticketId: 'b' } }], cursor: '2' }),
});

const allEvents: EventType[] = [
  orderCreated,
  orderShipped,
  auditLogged,
  webhookOnly,
  agentNote,
  ticketUpdated,
  brokenCheck,
  greedyCheck,
];

interface PollOverrides {
  name?: string;
  arguments?: Record<string, unknown>;
  cursor?: string | null;
  maxAgeMs?: number;
  maxEvents?: number;
  ctx?: unknown;
}

async function startScope(extra: Partial<FrontMcpConfigInput> = {}, events: EventType[] = allEvents): Promise<Scope> {
  @App({ id: 'shop', name: 'Shop', events })
  class ShopApp {}
  const { instance } = await createTestFetchServer({
    info: { name: 'event-poll-flow', version: '1.0.0' },
    apps: [ShopApp],
    authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
    ...extra,
  });
  return instance.getScopes()[0] as Scope;
}

function poll(scope: Scope, overrides: PollOverrides = {}): Promise<PollEventsResult> {
  const { name = 'order.created', ctx = anonymously, ...rest } = overrides;
  const request = { method: 'events/poll' as const, params: { name, ...rest } };
  return scope.runFlowForOutput('events:poll', { request, ctx });
}

function publisherOf(scope: Scope) {
  const publisher = scope.events?.publisher;
  if (!publisher) throw new Error('the scope has no publisher');
  return publisher;
}

function leasesOf(scope: Scope): EventPollLeases {
  return scope.events?.pollLeases as EventPollLeases;
}

async function placeOrders(scope: Scope, ...orders: Array<[string, string]>): Promise<void> {
  for (const [orderId, status] of orders) await publisherOf(scope).publish(orderCreated, { orderId, status });
}

function orderIdsOf(result: PollEventsResult): string[] {
  return result.events.map((occurrence) => String(occurrence.data['orderId']));
}

describe('events:poll', () => {
  let scope: Scope;

  beforeAll(async () => {
    scope = await startScope();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tickets.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(async () => {
    await scope.dispose();
  });

  describe('an event that is published', () => {
    it('answers a null cursor, or none, with no events and the current position', async () => {
      await placeOrders(scope, ['o-old', 'paid']);

      const fromNull = await poll(scope, { cursor: null });
      const fromNothing = await poll(scope);

      expect(fromNull).toEqual({
        events: [],
        cursor: expect.stringMatching(/^[0-9a-f]{32}\.\d+$/),
        truncated: false,
        hasMore: false,
        nextPollMs: 30_000,
      });
      expect(fromNothing.cursor).toBe(fromNull.cursor);
    });

    it('answers what was published since the cursor, once', async () => {
      const { cursor } = await poll(scope);
      await placeOrders(scope, ['o-1', 'paid'], ['o-2', 'refunded']);

      const first = await poll(scope, { cursor });
      const second = await poll(scope, { cursor: first.cursor });

      expect(first.events).toEqual([
        {
          eventId: expect.stringMatching(/^evt_/),
          name: 'order.created',
          timestamp: expect.any(String),
          data: { orderId: 'o-1', status: 'paid', note: 'for anyone' },
        },
        expect.objectContaining({ data: { orderId: 'o-2', status: 'refunded', note: 'for anyone' } }),
      ]);
      expect(first).toMatchObject({ truncated: false, hasMore: false, nextPollMs: 30_000 });
      expect(second).toMatchObject({ events: [], cursor: first.cursor, truncated: false, hasMore: false });
    });

    it('filters with match() and the arguments of the poll, and shapes with transform() for the reader', async () => {
      const { cursor } = await poll(scope);
      await placeOrders(scope, ['o-3', 'paid'], ['o-4', 'refunded'], ['o-5', 'explode'], ['o-6', 'paid']);

      const paid = await poll(scope, { cursor, arguments: { status: 'paid' } });

      expect(orderIdsOf(paid)).toEqual(['o-3', 'o-6']);
      expect(paid.events[0].data['note']).toBe('for anyone');
    });

    it('gives an occurrence published for an audience to the readers in it only', async () => {
      const { cursor } = await poll(scope);
      await publisherOf(scope).publish(
        orderCreated,
        { orderId: 'o-7', status: 'paid' },
        { audience: { roles: { any: ['admin'] } } },
      );
      await publisherOf(scope).publish(orderCreated, { orderId: 'o-8', status: 'paid' }, { audience: { sub: 'bob' } });

      expect(orderIdsOf(await poll(scope, { cursor, ctx: asAda }))).toEqual(['o-7']);
      expect(orderIdsOf(await poll(scope, { cursor, ctx: asBob }))).toEqual(['o-8']);
      expect(orderIdsOf(await poll(scope, { cursor }))).toEqual([]);
    });

    it('gives an occurrence published to one subscription to that poll subscription only', async () => {
      const targeted = { arguments: { status: 'targeted' } };
      const { cursor } = await poll(scope, { ctx: asAda, ...targeted });
      const adasSubscription = onSubscribe.mock.calls[0][1].id as string;
      await publisherOf(scope).publish(
        orderCreated,
        { orderId: 'o-9', status: 'targeted' },
        { subscriptionId: adasSubscription },
      );

      expect(orderIdsOf(await poll(scope, { cursor, ctx: asAda, ...targeted }))).toEqual(['o-9']);
      expect(orderIdsOf(await poll(scope, { cursor, ctx: asBob, ...targeted }))).toEqual([]);
      expect(orderIdsOf(await poll(scope, { cursor, ctx: asAda }))).toEqual([]);
    });

    it('returns at most maxEvents, says there is more, and resumes from where it stopped', async () => {
      const { cursor } = await poll(scope);
      await placeOrders(scope, ['o-10', 'paid'], ['o-11', 'x'], ['o-12', 'paid'], ['o-13', 'paid'], ['o-14', 'x']);
      const paid = { arguments: { status: 'paid' }, maxEvents: 2 };

      const first = await poll(scope, { cursor, ...paid });
      const second = await poll(scope, { cursor: first.cursor, ...paid });
      const third = await poll(scope, { cursor: second.cursor, ...paid });

      expect(orderIdsOf(first)).toEqual(['o-10', 'o-12']);
      expect(first.hasMore).toBe(true);
      expect(orderIdsOf(second)).toEqual(['o-13']);
      expect(second.hasMore).toBe(false);
      expect(third).toMatchObject({ events: [], hasMore: false, cursor: second.cursor });
    });

    it('has no more when the limit is reached by the last occurrence that matches', async () => {
      const { cursor } = await poll(scope);
      await placeOrders(scope, ['o-15', 'paid'], ['o-16', 'paid'], ['o-17', 'x']);

      const result = await poll(scope, { cursor, arguments: { status: 'paid' }, maxEvents: 2 });

      expect(orderIdsOf(result)).toEqual(['o-15', 'o-16']);
      expect(result.hasMore).toBe(false);
    });

    it('resumes from the cursor it was given when the first occurrence already exceeds a limit of none left', async () => {
      const limited = await startScope({ events: { poll: { maxEvents: 1 } } }, [orderShipped]);
      const { cursor } = await poll(limited, { name: 'order.shipped' });
      await publisherOf(limited).publish(orderShipped, { orderId: 's-1' });
      await publisherOf(limited).publish(orderShipped, { orderId: 's-2' });

      const first = await poll(limited, { name: 'order.shipped', cursor, maxEvents: 50 });
      const second = await poll(limited, { name: 'order.shipped', cursor: first.cursor });

      expect(orderIdsOf(first)).toEqual(['s-1']);
      expect(first.hasMore).toBe(true);
      expect(orderIdsOf(second)).toEqual(['s-2']);
      await limited.dispose();
    });

    it('skips what is older than maxAgeMs and says so, but only when a cursor is given', async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const { cursor } = await poll(scope);
      await placeOrders(scope, ['o-18', 'paid']);
      jest.setSystemTime(Date.now() + 120_000);
      await placeOrders(scope, ['o-19', 'paid']);

      const bounded = await poll(scope, { cursor, maxAgeMs: 60_000 });
      const unbounded = await poll(scope, { cursor });
      const fromNow = await poll(scope, { cursor: null, maxAgeMs: 1 });

      expect(orderIdsOf(bounded)).toEqual(['o-19']);
      expect(bounded.truncated).toBe(true);
      expect(orderIdsOf(unbounded)).toEqual(['o-18', 'o-19']);
      expect(unbounded.truncated).toBe(false);
      expect(fromNow).toMatchObject({ events: [], truncated: false });
    });

    it('answers a cursor it cannot place with a fresh one and truncated, never an error', async () => {
      await placeOrders(scope, ['o-20', 'paid']);

      const result = await poll(scope, { cursor: 'a-cursor-of-another-process.12' });

      expect(result).toMatchObject({ events: [], truncated: true, hasMore: false });
      expect(result.cursor).toMatch(/^[0-9a-f]{32}\.\d+$/);
    });

    it('answers a cursor older than what the buffer keeps with what is left, and truncated', async () => {
      const small = await startScope({ events: { buffer: { maxEvents: 2 } } }, [orderShipped]);
      const { cursor } = await poll(small, { name: 'order.shipped' });
      for (const orderId of ['s-1', 's-2', 's-3']) await publisherOf(small).publish(orderShipped, { orderId });

      const result = await poll(small, { name: 'order.shipped', cursor });

      expect(orderIdsOf(result)).toEqual(['s-2', 's-3']);
      expect(result.truncated).toBe(true);
      await small.dispose();
    });
  });

  describe('an event with check()', () => {
    it('asks check() for the current position on a null cursor', async () => {
      tickets.push({ id: 't-old' });

      const result = await poll(scope, { name: 'ticket.updated', arguments: { queue: 'billing' } });

      expect(result).toEqual({ events: [], cursor: '1', truncated: false, hasMore: false, nextPollMs: 600_000 });
      expect(checkCalls).toHaveBeenCalledWith({ queue: 'billing' }, null, { maxEvents: 100 });
    });

    it('gives what check() returns an id and a time when it has none, and keeps the ones it has', async () => {
      tickets.push({ id: 't-1' }, { id: 't-2', at: '2026-10-01T10:00:00.000Z' });
      const before = Date.now();

      const result = await poll(scope, { name: 'ticket.updated', cursor: '0' });

      expect(result.events).toEqual([
        {
          eventId: expect.stringMatching(/^evt_/),
          name: 'ticket.updated',
          timestamp: expect.any(String),
          data: { ticketId: 't-1' },
        },
        {
          eventId: 'evt_ticket_t-2',
          name: 'ticket.updated',
          timestamp: '2026-10-01T10:00:00.000Z',
          data: { ticketId: 't-2' },
        },
      ]);
      expect(Date.parse(result.events[0].timestamp)).toBeGreaterThanOrEqual(before);
      expect(result).toMatchObject({ cursor: '2', truncated: false, hasMore: false, nextPollMs: 30_000 });
    });

    it('passes the limits of the request to check(), and what it says about more and gaps to the client', async () => {
      tickets.push({ id: 't-1' }, { id: 't-2' }, { id: 't-3' });

      const first = await poll(scope, { name: 'ticket.updated', cursor: '0', maxEvents: 2, maxAgeMs: 60_000 });
      const beyond = await poll(scope, { name: 'ticket.updated', cursor: '9' });

      expect(checkCalls).toHaveBeenNthCalledWith(1, {}, '0', { maxEvents: 2, maxAgeMs: 60_000 });
      expect(first).toMatchObject({ cursor: '2', hasMore: true });
      expect(first.events).toHaveLength(2);
      expect(beyond).toMatchObject({ events: [], truncated: true });
    });

    it('leaves out what is older than maxAgeMs, and says so', async () => {
      const longAgo = new Date(Date.now() - 3_600_000).toISOString();
      tickets.push({ id: 't-old', at: longAgo }, { id: 't-new', at: new Date().toISOString() });

      const result = await poll(scope, { name: 'ticket.updated', cursor: '0', maxAgeMs: 60_000 });

      expect(result.events.map((occurrence) => occurrence.data['ticketId'])).toEqual(['t-new']);
      expect(result.truncated).toBe(true);
    });

    it('fails when check() returns more events than maxEvents, rather than drop any', async () => {
      const failure = poll(scope, { name: 'greedy.check', cursor: '0', maxEvents: 1 });

      await expect(failure).rejects.toThrow(InvalidEventPublishError);
      await expect(failure).rejects.toThrow('check() returned 2 events, more than limits.maxEvents (1)');
      await expect(poll(scope, { name: 'greedy.check', cursor: '0', maxEvents: 2 })).resolves.toMatchObject({
        cursor: '2',
      });
    });

    it('fails when check() returns data that does not match the payload schema', async () => {
      const failure = poll(scope, { name: 'broken.check', cursor: '0' });

      await expect(failure).rejects.toThrow(InvalidEventPublishError);
      await expect(failure).rejects.toThrow(
        'Event "broken.check" cannot be published: check() returned data that does not match payloadSchema',
      );
    });
  });

  describe('refusals', () => {
    it('answers an unknown event, and one not offered on the caller surface, with NotFound', async () => {
      const unknown = poll(scope, { name: 'order.refunded' });

      await expect(unknown).rejects.toThrow(EventNotFoundError);
      await expect(unknown).rejects.toMatchObject({ jsonRpcCode: -32023, data: { kind: 'event' } });
      await expect(poll(scope, { name: 'agent.note' })).rejects.toThrow(EventNotFoundError);
    });

    it('answers an event that is not offered by poll with Unsupported', async () => {
      const refusal = poll(scope, { name: 'webhook.only' });

      await expect(refusal).rejects.toThrow(EventUnsupportedError);
      await expect(refusal).rejects.toMatchObject({
        jsonRpcCode: -32026,
        data: { feature: 'deliveryMode', value: 'poll', supported: [] },
      });
    });

    it('answers a caller the authorities refuse with Forbidden, on every poll', async () => {
      await expect(poll(scope, { name: 'audit.logged', ctx: asBob })).rejects.toThrow(EventForbiddenError);
      await expect(poll(scope, { name: 'audit.logged' })).rejects.toMatchObject({ jsonRpcCode: -32024 });
      await expect(poll(scope, { name: 'audit.logged', ctx: asAda })).resolves.toMatchObject({ events: [] });
    });

    it('answers arguments the input schema refuses with InvalidParams', async () => {
      const refusal = poll(scope, { arguments: { status: 7 } });

      await expect(refusal).rejects.toThrow(InvalidInputError);
      await expect(refusal).rejects.toThrow('Invalid subscription arguments');
    });

    it('answers a refusal thrown by authorize() with Forbidden', async () => {
      authorize.mockRejectedValueOnce(new PublicMcpError('orders of another region'));

      await expect(poll(scope)).rejects.toMatchObject({
        jsonRpcCode: -32024,
        data: { reason: 'orders of another region' },
      });
      expect(authorize).toHaveBeenCalledWith({}, { sub: '', roles: [], permissions: [], scopes: [], claims: {} });
    });

    it('keeps what authorize() threw to itself unless it is public, and passes an events error through', async () => {
      authorize.mockRejectedValueOnce(new Error('internal detail'));
      await expect(poll(scope)).rejects.toMatchObject({ data: { reason: 'the event refused it' } });

      const ownRefusal = new EventForbiddenError({ forbidden: -32024 } as never, 'order.created', 'plan limit');
      authorize.mockRejectedValueOnce(ownRefusal);
      await expect(poll(scope)).rejects.toBe(ownRefusal);
    });

    it('answers a caller detected as OpenAI with the sketch codes', async () => {
      const asChatGpt = { authInfo: { ...bob, sessionIdPayload: { platformType: 'openai' } }, surface: 'mcp' };

      await expect(poll(scope, { name: 'order.refunded', ctx: asChatGpt })).rejects.toMatchObject({
        jsonRpcCode: -32011,
      });
      await expect(poll(scope, { name: 'audit.logged', ctx: asChatGpt })).rejects.toMatchObject({
        jsonRpcCode: -32012,
      });
    });

    it('refuses an anonymous caller on a server whose auth signs callers in', async () => {
      const signedIn = await startScope({ auth: { mode: 'local' } as never }, [orderShipped]);

      const refusal = poll(signedIn, { name: 'order.shipped' });

      await expect(refusal).rejects.toThrow(EventForbiddenError);
      await expect(refusal).rejects.toMatchObject({ data: { reason: 'this server needs a signed-in caller' } });
      await expect(poll(signedIn, { name: 'order.shipped', ctx: asBob })).resolves.toMatchObject({ events: [] });
      await signedIn.dispose();
    });
  });

  describe('the poll subscription', () => {
    it('calls onSubscribe at the first poll of a reader and its arguments, and not again', async () => {
      await poll(scope, { ctx: asBob, arguments: { status: 'lease-case' } });
      await poll(scope, { ctx: asBob, arguments: { status: 'lease-case' } });

      expect(onSubscribe).toHaveBeenCalledTimes(1);
      expect(onSubscribe).toHaveBeenCalledWith(
        { status: 'lease-case' },
        {
          id: expect.stringMatching(/^sub_[0-9a-f]{32}$/),
          name: 'order.created',
          mode: 'poll',
          subscriber: expect.objectContaining({ sub: 'bob', roles: ['member'] }),
        },
      );
    });

    it('is one for all anonymous callers, and another for each signed-in caller and each arguments', async () => {
      await poll(scope, { arguments: { status: 'shared-case' } });
      await poll(scope, { arguments: { status: 'shared-case' }, ctx: { surface: 'mcp', authInfo: {} } });
      await poll(scope, { arguments: { status: 'shared-case' }, ctx: asBob });
      await poll(scope, { arguments: { status: 'other-case' }, ctx: asBob });

      const ids = onSubscribe.mock.calls.map(([, subscription]) => subscription.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    });

    it('ends with onUnsubscribe expired when no poll renewed it for five minutes', async () => {
      await poll(scope, { arguments: { status: 'expiry-case' }, ctx: asAda });

      await leasesOf(scope).sweep(Date.now() + 299_000);
      expect(onUnsubscribe).not.toHaveBeenCalledWith({ status: 'expiry-case' }, expect.anything(), 'expired');

      await leasesOf(scope).sweep(Date.now() + 301_000);
      expect(onUnsubscribe).toHaveBeenCalledWith(
        { status: 'expiry-case' },
        expect.objectContaining({ mode: 'poll' }),
        'expired',
      );
    });

    it('lasts five of the intervals check() asks for', async () => {
      await poll(scope, { name: 'ticket.updated', arguments: { queue: 'long-lease' }, ctx: asAda });
      const subscriptionId = onSubscribe.mock.calls[0][1].id as string;

      await leasesOf(scope).sweep(Date.now() + 2_900_000);
      expect(leasesOf(scope).has(subscriptionId)).toBe(true);

      await leasesOf(scope).sweep(Date.now() + 3_100_000);
      expect(leasesOf(scope).has(subscriptionId)).toBe(false);
    });

    it('keeps no lease for an event without lifecycle methods', async () => {
      const before = leasesOf(scope).size;

      await poll(scope, { name: 'order.shipped', ctx: asAda });

      expect(leasesOf(scope).size).toBe(before);
    });

    it('refuses a new one past maxPerPrincipal, and still answers the ones a caller holds', async () => {
      const limited = await startScope({ events: { subscriptions: { maxPerPrincipal: 1 } } }, [orderCreated]);
      await poll(limited, { ctx: asAda, arguments: { status: 'one' } });

      const refusal = poll(limited, { ctx: asAda, arguments: { status: 'two' } });

      await expect(refusal).rejects.toThrow(EventResourceExhaustedError);
      await expect(refusal).rejects.toMatchObject({ jsonRpcCode: -32025, data: { limit: 'subscriptions', max: 1 } });
      await expect(poll(limited, { ctx: asAda, arguments: { status: 'one' } })).resolves.toBeDefined();
      await expect(poll(limited, { ctx: asBob, arguments: { status: 'two' } })).resolves.toBeDefined();
      await limited.dispose();
    });
  });

  describe('hooks', () => {
    it('runs the finalize stage of a poll that was answered and of one that was refused', async () => {
      const finalized = jest.fn();
      @Plugin({ name: 'poll-end' })
      class PollEndPlugin {
        @EventPollHook.Finally('finalize')
        recordEnd(ctx: FlowCtxOf<'events:poll'>) {
          finalized(ctx.rawInput.request?.params.name);
        }
      }
      const watched = await startScope({ plugins: [PollEndPlugin] }, [orderShipped]);

      await poll(watched, { name: 'order.shipped' });
      await expect(poll(watched, { name: 'order.refunded' })).rejects.toThrow(EventNotFoundError);

      expect(finalized.mock.calls).toEqual([['order.shipped'], ['order.refunded']]);
      await watched.dispose();
    });

    it('lets a plugin see what a poll read', async () => {
      const seen = jest.fn();
      @Plugin({ name: 'poll-audit' })
      class PollAuditPlugin {
        @EventPollHook.Did('readEvents')
        recordRead(ctx: FlowCtxOf<'events:poll'>) {
          seen(ctx.state.required.result.events.length);
        }
      }
      const audited = await startScope({ plugins: [PollAuditPlugin] }, [orderShipped]);
      const { cursor } = await poll(audited, { name: 'order.shipped' });
      await publisherOf(audited).publish(orderShipped, { orderId: 's-1' });

      await poll(audited, { name: 'order.shipped', cursor });

      expect(seen).toHaveBeenLastCalledWith(1);
      await audited.dispose();
    });
  });

  describe('with events.poll.enabled: false', () => {
    it('keeps the buffer for the streams of the push mode', async () => {
      const pushOnly = await startScope({ events: { poll: { enabled: false } } }, [orderShipped]);

      expect(pushOnly.events?.performs('poll')).toBe(false);
      expect(pushOnly.events?.performs('push')).toBe(true);
      expect(pushOnly.events?.buffer).toBeDefined();
      await pushOnly.dispose();
    });

    it('performs no poll mode and, without the push mode, keeps no buffer', async () => {
      const disabled = await startScope({ events: { poll: { enabled: false }, push: { enabled: false } } }, [
        orderShipped,
      ]);

      expect(disabled.events?.performs('poll')).toBe(false);
      expect(disabled.events?.buffer).toBeUndefined();
      expect(disabled.events?.servesEvents()).toBe(false);
      await expect(poll(disabled, { name: 'order.shipped' })).rejects.toThrow();
      await expect(publisherOf(disabled).publish(orderShipped, { orderId: 's-1' })).resolves.toMatchObject({
        matched: 0,
      });
      await disabled.dispose();
    });
  });
});
