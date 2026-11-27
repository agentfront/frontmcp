import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, Plugin, ScopeEntry, type FlowCtxOf } from '../../common';
import * as sdk from '../../index';
import { EventSubscribeHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { SUSPEND_AFTER_FAILURES } from '../flows/event-deliver.flow';
import {
  MAX_POLL_LEASES,
  POLL_LEASE_INTERVALS,
  POLL_LEASE_MIN_MS,
  POLL_LEASE_SWEEP_INTERVAL_MS,
  pollLeaseMs,
} from '../poll/event-poll-leases';
import { type EventStream } from '../stream/event-stream';
import { MAX_OPEN_STREAMS } from '../stream/event-streams';
import { SUBSCRIPTION_SWEEP_INTERVAL_MS, type EventSubscriptions } from '../subscription/event-subscriptions';

const SECRET = generateStandardWebhookSecret();
const CALLBACK = 'https://hooks.example.com:8443/mcp/callback?token=capability-0f3a';
const EMAIL = 'ada@example.com';

const ada = {
  sessionId: 'ada-session',
  user: { sub: 'ada', iss: 'https://auth.example.com', email: EMAIL },
};
const asAda = { authInfo: ada, surface: 'mcp' };

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string() },
  // With a lifecycle method, a poll subscription gets a lease
  onSubscribe: jest.fn(),
});

const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });

@App({ id: 'shop', name: 'Shop', events: [orderCreated, orderShipped] })
class ShopApp {}

/** The ids a plugin's hook listed after each subscription was stored, through `ctx.get(ScopeEntry)`. */
const listedInHook: string[][] = [];

@Plugin({ name: 'listeners' })
class ListenersPlugin {
  @EventSubscribeHook.Did('upsertSubscription')
  async listAfterStore(ctx: FlowCtxOf<'events:subscribe'>) {
    const listed = (await ctx.get(ScopeEntry).events?.listSubscriptions(ctx.state.required.event.name)) ?? [];
    listedInHook.push(listed.map((entry) => entry.id));
  }
}

describe('scope.events.listSubscriptions()', () => {
  let scope: Scope;

  function events() {
    const registry = scope.events;
    if (!registry) throw new Error('the scope has no events');
    return registry;
  }

  function subscriptions(): EventSubscriptions {
    return events().subscriptions as EventSubscriptions;
  }

  async function subscribe(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const request = {
      method: 'events/subscribe' as const,
      params: { name, arguments: args, delivery: { url: CALLBACK, secret: SECRET } },
    };
    const result = await scope.runFlowForOutput('events:subscribe', { request, ctx: asAda });
    return result.id;
  }

  function poll(name: string, args: Record<string, unknown> = {}) {
    const request = { method: 'events/poll' as const, params: { name, arguments: args } };
    return scope.runFlowForOutput('events:poll', { request, ctx: asAda });
  }

  beforeAll(async () => {
    const { instance } = await createTestFetchServer({
      info: { name: 'event-list-subscriptions', version: '1.0.0' },
      apps: [ShopApp],
      plugins: [ListenersPlugin],
      auth: { mode: 'local' } as never,
    });
    scope = instance.getScopes()[0] as Scope;
    jest.spyOn(subscriptions().verifier, 'verify').mockResolvedValue({ outcome: 'verified', verifiedAt: Date.now() });
  });

  afterAll(async () => {
    await scope.dispose();
  });

  it('lists a webhook subscription with its lifetime and delivery status, and the host of its callback', async () => {
    const id = await subscribe('order.created', { status: 'paid' });
    const record = await subscriptions().store.get(id);
    if (!record) throw new Error('the subscription was not stored');

    const listed = await events().listSubscriptions('order.created');

    expect(listed).toEqual([
      {
        id,
        eventName: 'order.created',
        mode: 'webhook',
        principalKey: 'principal:https://auth.example.com#ada',
        subscriber: { sub: 'ada', iss: 'https://auth.example.com' },
        arguments: { status: 'paid' },
        dialect: 'sep-3415',
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
        verifiedAt: record.verifiedAt,
        lastAuthorizedAt: record.lastAuthorizedAt,
        active: true,
        delivery: { host: 'hooks.example.com:8443', failures: 0 },
      },
    ]);
    expect(listedInHook).toEqual([[id]]);
  });

  it('shows no secret, no signing key, no callback path or query and no claim of the owner', async () => {
    const id = await subscribe('order.shipped');
    await subscriptions().store.update(id, (current) => ({
      delivery: { ...current.delivery, previousSecret: 'whsec_cHJldmlvdXMtc2lnbmluZy1rZXk=', previousSecretUntil: 1 },
    }));

    const serialized = JSON.stringify(await events().listSubscriptions());

    expect(serialized).toContain('hooks.example.com');
    for (const hidden of [SECRET, 'whsec_', '/mcp/callback', 'capability-0f3a', 'https://hooks', EMAIL, 'claims']) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it('shows the suspension and the failures of a webhook subscription', async () => {
    const id = await subscribe('order.created', { status: 'failing' });
    await subscriptions().store.update(id, {
      active: false,
      status: { lastError: 'http_5xx', failedSince: 1000, failures: 20, suspendedSince: 2000, lastDeliveryAt: 500 },
    });

    const [listed] = (await events().listSubscriptions('order.created')).filter((entry) => entry.id === id);

    expect(listed).toMatchObject({
      active: false,
      delivery: { failures: 20, suspendedSince: 2000, lastError: 'http_5xx', failedSince: 1000, lastDeliveryAt: 500 },
    });
  });

  it("lists this process's poll leases, with when each lapses", async () => {
    const before = Date.now();

    await poll('order.created', { status: 'polled' });

    const leases = (await events().listSubscriptions('order.created')).filter((entry) => entry.mode === 'poll');
    expect(leases).toEqual([
      {
        id: expect.stringMatching(/^sub_[0-9a-f]{32}$/),
        eventName: 'order.created',
        mode: 'poll',
        principalKey: 'principal:https://auth.example.com#ada',
        subscriber: { sub: 'ada', iss: 'https://auth.example.com' },
        arguments: { status: 'polled' },
        expiresAt: expect.any(Number),
      },
    ]);
    expect(leases[0].mode === 'poll' && leases[0].expiresAt).toBeGreaterThanOrEqual(before + POLL_LEASE_MIN_MS);
  });

  it("lists this process's open streams", async () => {
    const stream = {
      subscription: {
        id: 'sub_stream',
        name: 'order.shipped',
        mode: 'push',
        subscriber: { sub: 'ada', roles: [], permissions: [], scopes: [], claims: { email: EMAIL } },
      },
      eventName: 'order.shipped',
      principalKey: undefined,
      arguments: {},
      isClosed: false,
      onClose: () => undefined,
    } as unknown as EventStream;
    events().streams?.add(stream);

    const streams = (await events().listSubscriptions('order.shipped')).filter((entry) => entry.mode === 'push');

    expect(streams).toEqual([
      {
        id: 'sub_stream',
        eventName: 'order.shipped',
        mode: 'push',
        principalKey: undefined,
        subscriber: { sub: 'ada' },
        arguments: {},
      },
    ]);
  });

  it('lists the subscriptions of every event without a name, and none for a name it does not know', async () => {
    const all = await events().listSubscriptions();

    expect(new Set(all.map((entry) => entry.eventName))).toEqual(new Set(['order.created', 'order.shipped']));
    await expect(events().listSubscriptions('order.refunded')).resolves.toEqual([]);
  });
});

describe('the limits of event subscriptions, from the package root', () => {
  it('are the values the server applies', () => {
    expect(sdk.POLL_LEASE_MIN_MS).toBe(POLL_LEASE_MIN_MS);
    expect(sdk.POLL_LEASE_INTERVALS).toBe(POLL_LEASE_INTERVALS);
    expect(sdk.POLL_LEASE_SWEEP_INTERVAL_MS).toBe(POLL_LEASE_SWEEP_INTERVAL_MS);
    expect(sdk.MAX_POLL_LEASES).toBe(MAX_POLL_LEASES);
    expect(sdk.pollLeaseMs).toBe(pollLeaseMs);
    expect(sdk.MAX_OPEN_STREAMS).toBe(MAX_OPEN_STREAMS);
    expect(sdk.SUBSCRIPTION_SWEEP_INTERVAL_MS).toBe(SUBSCRIPTION_SWEEP_INTERVAL_MS);
    expect(sdk.SUSPEND_AFTER_FAILURES).toBe(SUSPEND_AFTER_FAILURES);
    expect(sdk.pollLeaseMs(120_000)).toBe(600_000);
  });
});
