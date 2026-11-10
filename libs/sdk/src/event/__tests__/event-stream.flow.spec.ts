import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, Plugin, type EventType, type FlowCtxOf, type FrontMcpConfigInput } from '../../common';
import {
  EventForbiddenError,
  EventNotFoundError,
  EventResourceExhaustedError,
  EventUnsupportedError,
  InvalidInputError,
} from '../../errors';
import { EventStreamHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { type EventStream, type EventStreamNotification } from '../stream/event-stream';

const ada = { sessionId: 'ada-session', user: { sub: 'ada', iss: 'https://auth.example.com', roles: ['admin'] } };
const bob = { sessionId: 'bob-session', user: { sub: 'bob', iss: 'https://auth.example.com', roles: ['member'] } };
const asAda = { authInfo: ada, surface: 'mcp' };
const asBob = { authInfo: bob, surface: 'mcp' };

const onSubscribe = jest.fn();
const onUnsubscribe = jest.fn();

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string(), status: z.string() },
  onSubscribe,
  onUnsubscribe,
  match: (occurrence, args) => args.status === undefined || args.status === occurrence.data.status,
});
const auditLogged = event({ name: 'audit.logged', payloadSchema: { action: z.string() }, authorities: 'admin' });
const webhookOnly = event({ name: 'webhook.only', payloadSchema: { id: z.string() }, delivery: ['webhook'] });
const allEvents: EventType[] = [orderCreated, auditLogged, webhookOnly];

interface StreamOverrides {
  name?: string;
  arguments?: Record<string, unknown>;
  cursor?: string | null;
  ctx?: unknown;
  signal?: AbortSignal;
}

async function startScope(extra: Partial<FrontMcpConfigInput> = {}): Promise<Scope> {
  @App({ id: 'shop', name: 'Shop', events: allEvents })
  class ShopApp {}
  const { instance } = await createTestFetchServer({
    info: { name: 'event-stream-flow', version: '1.0.0' },
    apps: [ShopApp],
    authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
    ...extra,
  });
  return instance.getScopes()[0] as Scope;
}

let nextRequestId = 1;

async function openStream(scope: Scope, overrides: StreamOverrides = {}): Promise<EventStream> {
  const { name = 'order.created', ctx = asAda, signal, ...rest } = overrides;
  const request = { method: 'events/stream' as const, params: { name, ...rest } };
  const { stream } = await scope.runFlowForOutput('events:stream', {
    request,
    ctx,
    requestId: nextRequestId++,
    signal,
  });
  return stream;
}

/** Reads what a stream has queued so far, without waiting for more. */
async function received(stream: EventStream, count: number): Promise<EventStreamNotification[]> {
  const notifications: EventStreamNotification[] = [];
  for await (const notification of stream) {
    notifications.push(notification);
    if (notifications.length === count) break;
  }
  return notifications;
}

describe('events:stream', () => {
  let scope: Scope;
  const open: EventStream[] = [];

  async function opened(overrides: StreamOverrides = {}): Promise<EventStream> {
    const stream = await openStream(scope, overrides);
    open.push(stream);
    return stream;
  }

  beforeAll(async () => {
    scope = await startScope();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const stream of open.splice(0)) stream.close();
  });

  afterAll(async () => {
    await scope.dispose();
  });

  it('offers the events by push, beside poll, on a server in public auth mode', () => {
    expect(scope.events?.performs('push')).toBe(true);
    expect(scope.events?.deliveryModesOf(scope.events.findByName('order.created') as never)).toEqual(['poll', 'push']);
  });

  it('opens a stream that confirms first, then carries what is published for its reader and arguments', async () => {
    const stream = await opened({ arguments: { status: 'paid' } });
    const publisher = scope.events?.publisher;

    await publisher?.publish(orderCreated, { orderId: 'o-1', status: 'refunded' });
    await publisher?.publish(orderCreated, { orderId: 'o-2', status: 'paid' });
    const [active, delivered] = await received(stream, 2);

    expect(active).toEqual({
      method: 'notifications/events/active',
      params: {
        cursor: expect.stringMatching(/^[0-9a-f]{32}\.\d+$/),
        truncated: false,
        _meta: { 'io.modelcontextprotocol/subscriptionId': expect.any(Number) },
      },
    });
    expect(delivered.method).toBe('notifications/events/event');
    expect(delivered.params).toMatchObject({
      eventId: expect.stringMatching(/^evt_/),
      name: 'order.created',
      data: { orderId: 'o-2', status: 'paid' },
      cursor: expect.any(String),
    });
    expect(delivered.params['_meta']).toEqual(active.params['_meta']);
  });

  it('replays from the cursor a poll or an earlier stream gave', async () => {
    const first = await opened();
    const [active] = await received(first, 1);
    await scope.events?.publisher?.publish(orderCreated, { orderId: 'o-3', status: 'paid' });

    const resumed = await opened({ cursor: active.params['cursor'] as string });
    const [, replayed] = await received(resumed, 2);

    expect(replayed.params).toMatchObject({ data: { orderId: 'o-3', status: 'paid' } });
  });

  it('calls onSubscribe when it opens and onUnsubscribe closed when its request ends', async () => {
    const controller = new AbortController();
    const stream = await opened({ arguments: { status: 'lifecycle' }, signal: controller.signal });

    expect(onSubscribe).toHaveBeenCalledWith(
      { status: 'lifecycle' },
      {
        id: expect.stringMatching(/^sub_[0-9a-f]{32}$/),
        name: 'order.created',
        mode: 'push',
        subscriber: expect.objectContaining({ sub: 'ada' }),
      },
    );
    expect(onUnsubscribe).not.toHaveBeenCalled();

    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));

    expect(stream.isClosed).toBe(true);
    expect(onUnsubscribe).toHaveBeenCalledWith(
      { status: 'lifecycle' },
      expect.objectContaining({ mode: 'push' }),
      'closed',
    );
    expect(scope.events?.streams?.size).toBe(0);
  });

  it('opens no stream when onSubscribe throws', async () => {
    onSubscribe.mockRejectedValueOnce(new Error('upstream'));

    await expect(openStream(scope)).rejects.toThrow('upstream');

    expect(scope.events?.streams?.size).toBe(0);
  });

  it('logs an onUnsubscribe that throws', async () => {
    onUnsubscribe.mockRejectedValueOnce(new Error('upstream'));
    const stream = await openStream(scope);

    stream.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
  });

  describe('refusals', () => {
    it('answers what a poll answers: unknown event, mode, authorities, arguments', async () => {
      await expect(openStream(scope, { name: 'order.refunded' })).rejects.toThrow(EventNotFoundError);
      await expect(openStream(scope, { name: 'webhook.only' })).rejects.toThrow(EventUnsupportedError);
      await expect(openStream(scope, { name: 'webhook.only' })).rejects.toMatchObject({
        data: { feature: 'deliveryMode', value: 'push', supported: [] },
      });
      await expect(openStream(scope, { name: 'audit.logged', ctx: asBob })).rejects.toThrow(EventForbiddenError);
      await expect(openStream(scope, { arguments: { status: 7 } })).rejects.toThrow(InvalidInputError);
    });

    it('answers a caller detected as OpenAI with the sketch codes', async () => {
      const asChatGpt = { authInfo: { ...bob, sessionIdPayload: { platformType: 'openai' } }, surface: 'mcp' };

      await expect(openStream(scope, { name: 'audit.logged', ctx: asChatGpt })).rejects.toMatchObject({
        jsonRpcCode: -32012,
      });
    });

    it('refuses one more stream than a caller may hold open', async () => {
      const limited = await startScope({ events: { subscriptions: { maxPerPrincipal: 1 } } });
      const first = await openStream(limited, { arguments: { status: 'one' } });

      const refusal = openStream(limited, { arguments: { status: 'two' } });

      await expect(refusal).rejects.toThrow(EventResourceExhaustedError);
      await expect(openStream(limited, { ctx: asBob })).resolves.toBeDefined();
      first.close();
      await limited.dispose();
    });

    it('refuses an anonymous caller on a server whose auth signs callers in, and lets one stream on a public server', async () => {
      const signedIn = await startScope({ auth: { mode: 'local' } as never });

      await expect(openStream(signedIn, { ctx: { surface: 'mcp' } })).rejects.toThrow(EventForbiddenError);
      const anonymous = await opened({ ctx: { surface: 'mcp' } });

      expect(anonymous.principalKey).toBeUndefined();
      await signedIn.dispose();
    });
  });

  it('ends a stream whose reader lost access, with terminated', async () => {
    jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const admin = await opened({ name: 'audit.logged' });
    const evaluate = jest.spyOn(scope.authoritiesEngine as never, 'evaluate' as never);
    evaluate.mockResolvedValue({ granted: false, deniedBy: 'role revoked' } as never);

    await jest.advanceTimersByTimeAsync(325_000);
    const notifications: EventStreamNotification[] = [];
    for await (const notification of admin) notifications.push(notification);
    jest.useRealTimers();
    evaluate.mockRestore();

    expect(notifications[notifications.length - 1]).toMatchObject({
      method: 'notifications/events/terminated',
      params: { error: { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } } },
    });
  });

  it('runs the hooks of a plugin, and closes its streams when the server stops', async () => {
    const seen = jest.fn();
    @Plugin({ name: 'stream-audit' })
    class StreamAuditPlugin {
      @EventStreamHook.Did('openStream')
      recordOpen(ctx: FlowCtxOf<'events:stream'>) {
        seen(ctx.state.required.stream.eventName);
      }
    }
    const audited = await startScope({ plugins: [StreamAuditPlugin] });

    const stream = await openStream(audited);
    await audited.dispose();

    expect(seen).toHaveBeenCalledWith('order.created');
    expect(stream.isClosed).toBe(true);
  });

  it('performs no push mode with events.push.enabled: false', async () => {
    const disabled = await startScope({ events: { push: { enabled: false } } });

    expect(disabled.events?.performs('push')).toBe(false);
    expect(disabled.events?.streams).toBeUndefined();
    await expect(openStream(disabled)).rejects.toThrow();
    await disabled.dispose();
  });
});
