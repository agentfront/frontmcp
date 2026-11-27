import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { EVENTS_SKETCH_ERROR_CODES } from '@frontmcp/protocol';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, Plugin, type EventSubscriptionRef, type FlowCtxOf } from '../../common';
import { EventForbiddenError } from '../../errors';
import { EventEndedHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { type EventTerminationError } from '../subscription/event-subscription-termination';
import { type EventSubscriptionRecord } from '../subscription/event-subscription.store';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const CALLBACK = 'https://hooks.example.com/mcp';
const SECRET = generateStandardWebhookSecret();
const HOUR_MS = 3_600_000;

const ada = { sessionId: 'ada-session', user: { sub: 'ada', iss: 'https://auth.example.com' } };
const asAda = { authInfo: ada, surface: 'mcp' };

interface SeenEnd {
  record: EventSubscriptionRecord;
  subscription: EventSubscriptionRef;
  reason: string;
  termination?: EventTerminationError;
}

/** What happened, in order: the event's `onUnsubscribe` and the plugin's `events:ended` hook. */
const calls: string[] = [];
const ends: SeenEnd[] = [];
let hookFails = false;

const onSubscribe = jest.fn((args: { status?: string }) => {
  if (args.status === 'refused') throw new Error('the upstream refused the watch');
});
const onUnsubscribe = jest.fn((_args: unknown, _subscription: unknown, reason: string) => {
  calls.push(`onUnsubscribe:${reason}`);
});
const noteAuthorize = jest.fn();

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string() },
  onSubscribe,
  onUnsubscribe,
});

const noteShared = event({
  name: 'note.shared',
  payloadSchema: { noteId: z.string() },
  authorize: noteAuthorize,
  onUnsubscribe,
});

@Plugin({ name: 'subscription-ends' })
class SubscriptionEndsPlugin {
  @EventEndedHook.Did('notifyEnded')
  recordEnd(ctx: FlowCtxOf<'events:ended'>) {
    const { record, subscription, reason } = ctx.state.required;
    calls.push(`ended:${reason}`);
    ends.push({ record, subscription, reason, ...(ctx.state.termination && { termination: ctx.state.termination }) });
    if (hookFails) throw new Error('the audit log is down');
  }
}

@App({ id: 'shop', name: 'Shop', events: [orderCreated, noteShared] })
class ShopApp {}

describe('events:ended', () => {
  let scope: Scope;
  let nextSubscription = 1;

  function subscriptions(): EventSubscriptions {
    return scope.events?.subscriptions as EventSubscriptions;
  }

  function keyOf(status: string) {
    return { name: 'order.created', arguments: { status }, delivery: { url: CALLBACK } };
  }

  async function subscribe(status: string): Promise<string> {
    const params = keyOf(status);
    const request = {
      method: 'events/subscribe' as const,
      params: { ...params, delivery: { url: CALLBACK, secret: SECRET } },
    };
    const result = await scope.runFlowForOutput('events:subscribe', { request, ctx: asAda });
    return result.id;
  }

  function unsubscribe(status: string) {
    const request = { method: 'events/unsubscribe' as const, params: keyOf(status) };
    return scope.runFlowForOutput('events:unsubscribe', { request, ctx: asAda });
  }

  /** A stored subscription, written to the store as another process would have. */
  async function stored(overrides: Partial<EventSubscriptionRecord> = {}): Promise<EventSubscriptionRecord> {
    const now = Date.now();
    const record: EventSubscriptionRecord = {
      id: `sub_ended_${String(nextSubscription++).padStart(4, '0')}`,
      principalKey: 'principal:https://auth.example.com#ada',
      subscriber: { sub: 'ada', iss: 'https://auth.example.com', roles: [], permissions: [], scopes: [], claims: {} },
      eventName: 'order.created',
      arguments: {},
      argumentsKey: '{}',
      delivery: { mode: 'webhook', url: CALLBACK, secret: SECRET },
      dialect: 'sep-3415',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + HOUR_MS,
      verifiedAt: now,
      lastAuthorizedAt: now,
      active: true,
      status: {},
      ...overrides,
    };
    await subscriptions().store.upsert(record);
    return record;
  }

  beforeAll(async () => {
    const { instance } = await createTestFetchServer({
      info: { name: 'event-ended-flow', version: '1.0.0' },
      apps: [ShopApp],
      plugins: [SubscriptionEndsPlugin],
      auth: { mode: 'local' } as never,
    });
    scope = instance.getScopes()[0] as Scope;
    jest.spyOn(subscriptions().verifier, 'verify').mockResolvedValue({ outcome: 'verified', verifiedAt: Date.now() });
  });

  beforeEach(() => {
    calls.length = 0;
    ends.length = 0;
    hookFails = false;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await scope.dispose();
  });

  it('runs for a subscription the client unsubscribes, after its event was told', async () => {
    const id = await subscribe('paid');
    const record = await subscriptions().store.get(id);

    await expect(unsubscribe('paid')).resolves.toEqual({});

    expect(calls).toEqual(['onUnsubscribe:unsubscribed', 'ended:unsubscribed']);
    expect(ends).toEqual([
      {
        record,
        subscription: { id, name: 'order.created', mode: 'webhook', subscriber: record?.subscriber },
        reason: 'unsubscribed',
      },
    ]);
  });

  it('does not run again for a repeated unsubscribe, which removes nothing', async () => {
    await subscribe('twice');
    await unsubscribe('twice');
    calls.length = 0;

    await unsubscribe('twice');

    expect(calls).toEqual([]);
  });

  it('runs for each subscription the expiry sweep ends', async () => {
    const lapsed = await stored({ expiresAt: Date.now() - 1 });
    const live = await stored();

    await subscriptions().sweep();

    expect(calls).toEqual(['onUnsubscribe:expired', 'ended:expired']);
    expect(ends.map((end) => [end.record.id, end.reason])).toEqual([[lapsed.id, 'expired']]);
    await expect(subscriptions().store.get(live.id)).resolves.toBeDefined();
    await subscriptions().store.delete(live.id);
  });

  it('runs with the termination error for a subscription whose owner is refused when checked again', async () => {
    const revoked = await stored({ eventName: 'note.shared', dialect: 'sketch', lastAuthorizedAt: 0 });
    noteAuthorize.mockRejectedValueOnce(new EventForbiddenError(EVENTS_SKETCH_ERROR_CODES, 'note.shared', 'revoked'));

    const result = await scope.events?.publisher?.publish(noteShared, { noteId: 'n-1' });

    expect(result?.matched).toBe(0);
    await expect(subscriptions().store.get(revoked.id)).resolves.toBeUndefined();
    expect(calls).toEqual(['onUnsubscribe:terminated', 'ended:terminated']);
    expect(ends).toEqual([
      expect.objectContaining({
        record: revoked,
        reason: 'terminated',
        termination: {
          code: EVENTS_SKETCH_ERROR_CODES.forbidden,
          message: 'Forbidden',
          data: { reason: 'Access revoked' },
        },
      }),
    ]);
  });

  it('leaves the unsubscribe, its answer and onUnsubscribe as they are when a hook throws', async () => {
    const id = await subscribe('broken-hook');
    hookFails = true;

    await expect(unsubscribe('broken-hook')).resolves.toEqual({});

    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['onUnsubscribe:unsubscribed', 'ended:unsubscribed']);
    await expect(subscriptions().store.get(id)).resolves.toBeUndefined();
  });

  it('does not run for a subscription whose onSubscribe threw, which never started', async () => {
    await expect(subscribe('refused')).rejects.toThrow('the upstream refused the watch');

    expect(onSubscribe).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });
});
