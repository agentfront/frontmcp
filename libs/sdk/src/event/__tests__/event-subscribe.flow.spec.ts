import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type SubscribeEventResult } from '@frontmcp/protocol';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  event,
  Plugin,
  type EventSubscriber,
  type EventType,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '../../common';
import {
  EventCallbackEndpointError,
  EventForbiddenError,
  EventNotFoundError,
  EventResourceExhaustedError,
  EventUnsupportedError,
  InvalidInputError,
  PublicMcpError,
} from '../../errors';
import { EventSubscribeHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { type EventCallbackVerification } from '../subscription/event-callback-verifier';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const CALLBACK = 'https://hooks.example.com/mcp';
const SECRET = generateStandardWebhookSecret();
const HOUR_MS = 3_600_000;
const payloadSchema = { orderId: z.string() };

const ada = { sessionId: 'ada-session', user: { sub: 'ada', iss: 'https://auth.example.com', roles: ['admin'] } };
const bob = { sessionId: 'bob-session', user: { sub: 'bob', iss: 'https://auth.example.com', roles: ['member'] } };
const chatgpt = { ...bob, sessionIdPayload: { platformType: 'openai' } };
const anonymous = { sessionId: 'anonymous-session', user: { sub: 'anon:1f6c' } };

const onSubscribe = jest.fn();
const onUnsubscribe = jest.fn();
const authorize = jest.fn();

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional(), region: z.string().optional() },
  payloadSchema,
  onSubscribe,
  onUnsubscribe,
  authorize,
});
const orderShipped = event({ name: 'order.shipped', payloadSchema });
const auditLogged = event({ name: 'audit.logged', payloadSchema, authorities: 'admin' });
const tenantUpdated = event({
  name: 'tenant.updated',
  inputSchema: { tenant: z.string() },
  payloadSchema,
  authorities: { attributes: { conditions: [{ path: 'user.sub', op: 'eq', value: { fromInput: 'tenant' } }] } },
});
const agentNote = event({ name: 'agent.note', payloadSchema, availableWhen: { surface: ['agent'] } });
const pollOnly = event({ name: 'poll.only', payloadSchema, delivery: ['poll'] });
const shortLived = event({ name: 'short.lived', payloadSchema, ttl: { defaultMs: 120_000, maxMs: 600_000 } });

const allEvents = [orderCreated, orderShipped, auditLogged, tenantUpdated, agentNote, pollOnly, shortLived];

interface SubscribeOverrides {
  name?: string;
  arguments?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  ttlMs?: number | null;
  ctx?: unknown;
}

async function startScope(events: EventType[] = allEvents, extra: Partial<FrontMcpConfigInput> = {}): Promise<Scope> {
  @App({ id: 'shop', name: 'Shop', events })
  class ShopApp {}
  const { instance } = await createTestFetchServer({
    info: { name: 'event-subscribe-flow', version: '1.0.0' },
    apps: [ShopApp],
    auth: { mode: 'local' } as never,
    authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
    ...extra,
  });
  return instance.getScopes()[0] as Scope;
}

function subscriptionsOf(scope: Scope): EventSubscriptions {
  return scope.events?.subscriptions as EventSubscriptions;
}

function verifyAs(scope: Scope, verification?: EventCallbackVerification): jest.SpyInstance {
  const verifier = subscriptionsOf(scope).verifier;
  const outcome = verification ?? { outcome: 'verified', verifiedAt: Date.now() };
  return jest.spyOn(verifier, 'verify').mockResolvedValue(outcome);
}

function subscribe(scope: Scope, overrides: SubscribeOverrides = {}): Promise<SubscribeEventResult> {
  const { name = 'order.created', ctx = { authInfo: ada, surface: 'mcp' } } = overrides;
  const params = {
    name,
    ...(overrides.arguments && { arguments: overrides.arguments }),
    delivery: { url: CALLBACK, secret: SECRET, ...overrides.delivery },
    ...(overrides.ttlMs !== undefined && { ttlMs: overrides.ttlMs }),
  };
  const request = { method: 'events/subscribe' as const, params };
  return scope.runFlowForOutput('events:subscribe', { request: request as never, ctx });
}

describe('events:subscribe', () => {
  let scope: Scope;
  let verify: jest.SpyInstance;

  beforeAll(async () => {
    scope = await startScope();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    verify = verifyAs(scope);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterAll(async () => {
    await scope.dispose();
  });

  describe('a new subscription', () => {
    it('is stored for its owner and answered with its id and lifetime', async () => {
      const before = Date.now();

      const result = await subscribe(scope, { arguments: { status: 'paid' } });

      const stored = await subscriptionsOf(scope).store.get(result.id);
      expect(result.id).toMatch(/^sub_[0-9a-f]{32}$/);
      expect(result).toEqual({
        id: result.id,
        refreshBefore: new Date(stored?.expiresAt as number).toISOString(),
        cursor: null,
        truncated: false,
      });
      expect((stored?.expiresAt as number) - before).toBeGreaterThanOrEqual(HOUR_MS);
      expect(stored).toMatchObject({
        id: result.id,
        principalKey: 'principal:https://auth.example.com#ada',
        subscriber: { sub: 'ada', iss: 'https://auth.example.com', roles: ['admin'] },
        eventName: 'order.created',
        arguments: { status: 'paid' },
        argumentsKey: '{"status":"paid"}',
        delivery: { mode: 'webhook', url: CALLBACK, secret: SECRET },
        dialect: 'sep-3415',
        active: true,
        status: {},
      });
    });

    it('verifies the callback with the subscription it is about to store', async () => {
      const result = await subscribe(scope, { arguments: { status: 'verified-case' } });

      expect(verify).toHaveBeenCalledWith({
        principalKey: 'principal:https://auth.example.com#ada',
        url: CALLBACK,
        secret: SECRET,
        subscriptionId: result.id,
        verifiedAt: undefined,
      });
    });

    it('calls authorize and onSubscribe with the parsed arguments', async () => {
      const result = await subscribe(scope, { arguments: { status: 'hooks-case', unknown: 'dropped' } });

      const subscriber: EventSubscriber = expect.objectContaining({ sub: 'ada', roles: ['admin'] });
      expect(authorize).toHaveBeenCalledWith({ status: 'hooks-case' }, subscriber);
      expect(onSubscribe).toHaveBeenCalledTimes(1);
      expect(onSubscribe).toHaveBeenCalledWith(
        { status: 'hooks-case' },
        { id: result.id, name: 'order.created', mode: 'webhook', subscriber },
      );
    });

    it('accepts the webhook mode by name and an event without arguments', async () => {
      const result = await subscribe(scope, { name: 'order.shipped', delivery: { mode: 'webhook' } });

      await expect(subscriptionsOf(scope).store.get(result.id)).resolves.toMatchObject({ arguments: {} });
    });

    it('belongs to the caller: another caller gets another subscription', async () => {
      const mine = await subscribe(scope, { arguments: { status: 'owner-case' } });
      const theirs = await subscribe(scope, {
        arguments: { status: 'owner-case' },
        ctx: { authInfo: bob, surface: 'mcp' },
      });

      expect(theirs.id).not.toBe(mine.id);
    });

    it('is taken back when onSubscribe throws', async () => {
      onSubscribe.mockRejectedValueOnce(new Error('upstream registration failed'));
      const { id } = subscriptionsOf(scope).identityOf(
        'principal:https://auth.example.com#ada',
        CALLBACK,
        'order.created',
        { status: 'failing-hook' },
      );

      await expect(subscribe(scope, { arguments: { status: 'failing-hook' } })).rejects.toThrow(
        'upstream registration failed',
      );
      await expect(subscriptionsOf(scope).store.get(id)).resolves.toBeUndefined();
    });
  });

  describe('a refresh', () => {
    it('keeps the id, whatever the order of the argument keys, and reports the delivery status', async () => {
      const first = await subscribe(scope, { arguments: { status: 'paid', region: 'eu' } });
      onSubscribe.mockClear();

      const second = await subscribe(scope, { arguments: { region: 'eu', status: 'paid' } });

      expect(second.id).toBe(first.id);
      expect(second.deliveryStatus).toEqual({ active: true, lastDeliveryAt: null, lastError: null, failedSince: null });
      expect(onSubscribe).not.toHaveBeenCalled();
    });

    it('passes the stored proof to the verifier', async () => {
      const first = await subscribe(scope, { arguments: { status: 'proof-case' } });
      const stored = await subscriptionsOf(scope).store.get(first.id);

      await subscribe(scope, { arguments: { status: 'proof-case' } });

      expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ verifiedAt: stored?.verifiedAt }));
    });

    it('replaces the secret and keeps the old one for the grace period', async () => {
      const first = await subscribe(scope, { arguments: { status: 'rotation-case' } });
      const newSecret = generateStandardWebhookSecret();
      const before = Date.now();

      await subscribe(scope, { arguments: { status: 'rotation-case' }, delivery: { secret: newSecret } });

      const stored = await subscriptionsOf(scope).store.get(first.id);
      expect(stored?.delivery).toMatchObject({ secret: newSecret, previousSecret: SECRET });
      expect(stored?.delivery.previousSecretUntil).toBeGreaterThanOrEqual(before + 300_000);
    });

    it('reactivates a suspended subscription and replaces the owner snapshot', async () => {
      const first = await subscribe(scope, { arguments: { status: 'reactivation-case' } });
      const store = subscriptionsOf(scope).store;
      await store.update(first.id, { active: false, status: { lastError: 'http_5xx', failedSince: 1000 } });
      const promoted = { ...ada, user: { ...ada.user, roles: ['admin', 'auditor'] } };

      const second = await subscribe(scope, {
        arguments: { status: 'reactivation-case' },
        ctx: { authInfo: promoted, surface: 'mcp' },
      });

      expect(second.deliveryStatus).toMatchObject({ active: true, lastError: 'http_5xx' });
      await expect(store.get(first.id)).resolves.toMatchObject({
        active: true,
        subscriber: { roles: ['admin', 'auditor'] },
      });
    });

    it('of a subscription whose lifetime ended starts a new one, after the old one is told it expired', async () => {
      const first = await subscribe(scope, { arguments: { status: 'expiry-case' }, ttlMs: 60_000 });
      jest.clearAllMocks();
      verify = verifyAs(scope);
      jest.useFakeTimers({ now: Date.now() + 61_000, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

      const second = await subscribe(scope, { arguments: { status: 'expiry-case' } });

      expect(second.id).toBe(first.id);
      expect(second.deliveryStatus).toBeUndefined();
      expect(onUnsubscribe).toHaveBeenCalledWith({ status: 'expiry-case' }, expect.anything(), 'expired');
      expect(onSubscribe).toHaveBeenCalledTimes(1);
      expect(onUnsubscribe.mock.invocationCallOrder[0]).toBeLessThan(onSubscribe.mock.invocationCallOrder[0]);
    });
  });

  describe('the lifetime', () => {
    async function grantedMs(overrides: SubscribeOverrides): Promise<number> {
      const before = Date.now();
      const result = await subscribe(scope, overrides);
      return Math.round((Date.parse(result.refreshBefore as string) - before) / 1000) * 1000;
    }

    it('is the default without ttlMs', async () => {
      await expect(grantedMs({ arguments: { status: 'ttl-default' } })).resolves.toBe(HOUR_MS);
    });

    it('is the requested one within the bounds', async () => {
      await expect(grantedMs({ arguments: { status: 'ttl-asked' }, ttlMs: 600_000 })).resolves.toBe(600_000);
    });

    it('is clamped to the maximum and raised to the minimum', async () => {
      await expect(grantedMs({ arguments: { status: 'ttl-long' }, ttlMs: 7 * 24 * HOUR_MS })).resolves.toBe(
        24 * HOUR_MS,
      );
      await expect(grantedMs({ arguments: { status: 'ttl-short' }, ttlMs: 1 })).resolves.toBe(60_000);
    });

    it('is finite for a request without expiry on the memory store', async () => {
      await expect(grantedMs({ arguments: { status: 'ttl-none' }, ttlMs: null })).resolves.toBe(24 * HOUR_MS);
    });

    it("follows the event's own bounds", async () => {
      await expect(grantedMs({ name: 'short.lived' })).resolves.toBe(120_000);
      await expect(grantedMs({ name: 'short.lived', ttlMs: HOUR_MS })).resolves.toBe(600_000);
    });
  });

  describe('refusals', () => {
    it('answers an unknown event with NotFound', async () => {
      const refusal = subscribe(scope, { name: 'order.refunded' });

      await expect(refusal).rejects.toThrow(EventNotFoundError);
      await expect(refusal).rejects.toMatchObject({ jsonRpcCode: -32023, data: { kind: 'event' } });
    });

    it('answers an event that is not offered on the caller surface as an unknown one', async () => {
      await expect(subscribe(scope, { name: 'agent.note' })).rejects.toThrow(EventNotFoundError);
    });

    it('answers a delivery mode other than webhook with Unsupported', async () => {
      const refusal = subscribe(scope, { delivery: { mode: 'push' } });

      await expect(refusal).rejects.toThrow(EventUnsupportedError);
      await expect(refusal).rejects.toMatchObject({
        jsonRpcCode: -32026,
        data: { feature: 'deliveryMode', value: 'push', supported: ['poll', 'webhook'] },
      });
    });

    it('answers an event that is not offered by webhook with Unsupported', async () => {
      await expect(subscribe(scope, { name: 'poll.only' })).rejects.toMatchObject({
        jsonRpcCode: -32026,
        data: { feature: 'deliveryMode', value: 'webhook', supported: ['poll'] },
      });
    });

    it.each([
      ['an anonymous caller', { authInfo: anonymous, surface: 'mcp' }],
      ['a caller without auth', { surface: 'mcp' }],
      ['a request without context', undefined],
    ])('answers %s with Forbidden', async (_label, ctx) => {
      const refusal = scope.runFlowForOutput('events:subscribe', {
        request: {
          method: 'events/subscribe',
          params: { name: 'order.created', delivery: { url: CALLBACK, secret: SECRET } },
        },
        ctx,
      });

      await expect(refusal).rejects.toThrow(EventForbiddenError);
      await expect(refusal).rejects.toMatchObject({
        jsonRpcCode: -32024,
        data: { reason: 'a webhook subscription needs a signed-in caller' },
      });
    });

    it('answers a caller the authorities refuse with Forbidden', async () => {
      const refusal = subscribe(scope, { name: 'audit.logged', ctx: { authInfo: bob, surface: 'mcp' } });

      await expect(refusal).rejects.toThrow(EventForbiddenError);
      await expect(subscribe(scope, { name: 'audit.logged' })).resolves.toMatchObject({ cursor: null });
    });

    it('evaluates the authorities with the subscription arguments as input', async () => {
      await expect(subscribe(scope, { name: 'tenant.updated', arguments: { tenant: 'bob' } })).rejects.toThrow(
        EventForbiddenError,
      );
      await expect(subscribe(scope, { name: 'tenant.updated', arguments: { tenant: 'ada' } })).resolves.toBeDefined();
    });

    it('answers arguments the input schema refuses with InvalidParams', async () => {
      const refusal = subscribe(scope, { arguments: { status: 7 } });

      await expect(refusal).rejects.toThrow(InvalidInputError);
      await expect(refusal).rejects.toThrow('Invalid subscription arguments');
      await expect(subscribe(scope, { name: 'order.shipped', arguments: { anything: 1 } })).rejects.toThrow(
        InvalidInputError,
      );
    });

    it('answers a refusal thrown by authorize with Forbidden, with its message only when it is public', async () => {
      authorize.mockRejectedValueOnce(new Error('internal detail'));
      await expect(subscribe(scope)).rejects.toMatchObject({ data: { reason: 'the event refused it' } });

      authorize.mockRejectedValueOnce(new PublicMcpError('orders of another region'));
      await expect(subscribe(scope)).rejects.toMatchObject({ data: { reason: 'orders of another region' } });

      const ownRefusal = new EventForbiddenError({ forbidden: -32024 } as never, 'order.created', 'plan limit');
      authorize.mockRejectedValueOnce(ownRefusal);
      await expect(subscribe(scope)).rejects.toBe(ownRefusal);
    });

    it.each([
      ['an http callback', 'http://hooks.example.com/mcp', 'Invalid delivery.url: it must use https'],
      ['a callback that is not a URL', 'hooks.example.com', 'Invalid delivery.url: it is not a URL'],
      [
        'a local callback',
        'https://127.0.0.1/mcp',
        'Invalid delivery.url: its host is local, private or a metadata service',
      ],
      [
        'a callback with credentials',
        'https://user:password@hooks.example.com/mcp',
        'Invalid delivery.url: it must not carry a user name or a password',
      ],
    ])('answers %s with InvalidParams', async (_label, url, message) => {
      const refusal = subscribe(scope, { delivery: { url } });

      await expect(refusal).rejects.toThrow(InvalidInputError);
      await expect(refusal).rejects.toThrow(message);
      expect(verify).not.toHaveBeenCalled();
    });

    it('answers a secret that is not a Standard Webhooks one with InvalidParams', async () => {
      await expect(subscribe(scope, { delivery: { secret: 'too-short' } })).rejects.toThrow(
        'Invalid delivery.secret: expected "whsec_" followed by base64 that decodes to 24 to 64 bytes',
      );
    });

    it('answers a callback that fails verification with the category, and stores nothing', async () => {
      verify.mockResolvedValue({ outcome: 'failed', reason: 'challenge_failed' });
      const refusal = subscribe(scope, { arguments: { status: 'unverified-case' } });

      await expect(refusal).rejects.toThrow(EventCallbackEndpointError);
      await expect(refusal).rejects.toMatchObject({ jsonRpcCode: -32027, data: { reason: 'challenge_failed' } });
      expect(onSubscribe).not.toHaveBeenCalled();
    });

    it('answers a callback host that is verified too often with ResourceExhausted', async () => {
      verify.mockResolvedValue({ outcome: 'limited', max: 10 });

      await expect(subscribe(scope, { arguments: { status: 'limited-case' } })).rejects.toMatchObject({
        jsonRpcCode: -32025,
        data: { limit: 'verifications', max: 10 },
      });
    });
  });

  describe('dialects', () => {
    it('answers a caller detected as OpenAI with the sketch codes, and stores the dialect', async () => {
      const asChatGpt = { authInfo: chatgpt, surface: 'mcp' };

      await expect(subscribe(scope, { name: 'order.refunded', ctx: asChatGpt })).rejects.toMatchObject({
        jsonRpcCode: -32011,
      });
      await expect(subscribe(scope, { name: 'audit.logged', ctx: asChatGpt })).rejects.toMatchObject({
        jsonRpcCode: -32012,
      });
      await expect(subscribe(scope, { delivery: { mode: 'poll' }, ctx: asChatGpt })).rejects.toMatchObject({
        jsonRpcCode: -32014,
      });

      const result = await subscribe(scope, { name: 'order.shipped', ctx: asChatGpt });
      await expect(subscriptionsOf(scope).store.get(result.id)).resolves.toMatchObject({ dialect: 'sketch' });
    });

    it('answers every caller in the dialect events.compat pins', async () => {
      const pinned = await startScope([orderShipped], { events: { compat: 'sketch' } });
      verifyAs(pinned);

      await expect(subscribe(pinned, { name: 'order.refunded' })).rejects.toMatchObject({ jsonRpcCode: -32011 });
      await pinned.dispose();
    });
  });

  describe('limits', () => {
    it('refuses a new subscription past maxPerPrincipal, and still refreshes an existing one', async () => {
      const limited = await startScope([orderCreated], { events: { subscriptions: { maxPerPrincipal: 2 } } });
      verifyAs(limited);
      const first = await subscribe(limited, { arguments: { status: 'one' } });
      await subscribe(limited, { arguments: { status: 'two' } });

      const refusal = subscribe(limited, { arguments: { status: 'three' } });

      await expect(refusal).rejects.toThrow(EventResourceExhaustedError);
      await expect(refusal).rejects.toMatchObject({ jsonRpcCode: -32025, data: { limit: 'subscriptions', max: 2 } });
      await expect(subscribe(limited, { arguments: { status: 'one' } })).resolves.toMatchObject({ id: first.id });
      await expect(
        subscribe(limited, { arguments: { status: 'three' }, ctx: { authInfo: bob, surface: 'mcp' } }),
      ).resolves.toBeDefined();
      await limited.dispose();
    });
  });

  describe('hooks', () => {
    it('lets a plugin refuse a subscription before the callback is contacted', async () => {
      @Plugin({ name: 'subscription-policy' })
      class SubscriptionPolicyPlugin {
        @EventSubscribeHook.Will('verifyCallback')
        refuseForeignCallbacks(ctx: FlowCtxOf<'events:subscribe'>) {
          const { url } = ctx.rawInput.request.params.delivery;
          if (!url.startsWith('https://hooks.example.com/')) throw new PublicMcpError('callback host is not ours');
        }
      }
      const guarded = await startScope([orderShipped], { plugins: [SubscriptionPolicyPlugin] });
      const guardedVerify = verifyAs(guarded);

      await expect(
        subscribe(guarded, { name: 'order.shipped', delivery: { url: 'https://elsewhere.example.net/mcp' } }),
      ).rejects.toThrow('callback host is not ours');
      expect(guardedVerify).not.toHaveBeenCalled();
      await expect(subscribe(guarded, { name: 'order.shipped' })).resolves.toBeDefined();
      await guarded.dispose();
    });
  });
});
