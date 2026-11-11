import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, Plugin, type FlowCtxOf } from '../../common';
import { EventForbiddenError } from '../../errors';
import { EventUnsubscribeHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const CALLBACK = 'https://hooks.example.com/mcp';
const SECRET = generateStandardWebhookSecret();
const payloadSchema = { orderId: z.string() };

const ada = { sessionId: 'ada-session', user: { sub: 'ada', iss: 'https://auth.example.com' } };
const bob = { sessionId: 'bob-session', user: { sub: 'bob', iss: 'https://auth.example.com' } };
const asAda = { authInfo: ada, surface: 'mcp' };
const asBob = { authInfo: bob, surface: 'mcp' };

const onUnsubscribe = jest.fn();
const removals = jest.fn();

const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional(), region: z.string().optional() },
  payloadSchema,
  onUnsubscribe,
});

@Plugin({ name: 'removal-audit' })
class RemovalAuditPlugin {
  @EventUnsubscribeHook.Did('removeSubscription')
  recordRemoval(ctx: FlowCtxOf<'events:unsubscribe'>) {
    removals(ctx.rawInput.request.params.name);
  }
}

@App({ id: 'shop', name: 'Shop', events: [orderCreated] })
class ShopApp {}

interface RequestOverrides {
  name?: string;
  arguments?: Record<string, unknown>;
  url?: string;
  ctx?: unknown;
}

describe('events:unsubscribe', () => {
  let scope: Scope;

  function subscriptions(): EventSubscriptions {
    return scope.events?.subscriptions as EventSubscriptions;
  }

  function paramsOf({ name = 'order.created', arguments: args, url = CALLBACK }: RequestOverrides) {
    return { name, ...(args && { arguments: args }), delivery: { url } };
  }

  async function subscribe(overrides: RequestOverrides = {}): Promise<string> {
    const params = paramsOf(overrides);
    const request = {
      method: 'events/subscribe' as const,
      params: { ...params, delivery: { url: params.delivery.url, secret: SECRET } },
    };
    const result = await scope.runFlowForOutput('events:subscribe', { request, ctx: overrides.ctx ?? asAda });
    return result.id;
  }

  function unsubscribe(overrides: RequestOverrides = {}) {
    const request = { method: 'events/unsubscribe' as const, params: paramsOf(overrides) };
    return scope.runFlowForOutput('events:unsubscribe', { request, ctx: 'ctx' in overrides ? overrides.ctx : asAda });
  }

  beforeAll(async () => {
    const { instance } = await createTestFetchServer({
      info: { name: 'event-unsubscribe-flow', version: '1.0.0' },
      apps: [ShopApp],
      plugins: [RemovalAuditPlugin],
      auth: { mode: 'local' } as never,
    });
    scope = instance.getScopes()[0] as Scope;
    jest.spyOn(subscriptions().verifier, 'verify').mockResolvedValue({ outcome: 'verified', verifiedAt: Date.now() });
  });

  beforeEach(() => {
    onUnsubscribe.mockClear();
    removals.mockClear();
  });

  afterAll(async () => {
    await scope.dispose();
  });

  it('removes the subscription and tells its event why', async () => {
    const id = await subscribe({ arguments: { status: 'paid' } });

    await expect(unsubscribe({ arguments: { status: 'paid' } })).resolves.toEqual({});

    await expect(subscriptions().store.get(id)).resolves.toBeUndefined();
    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
    expect(onUnsubscribe).toHaveBeenCalledWith(
      { status: 'paid' },
      { id, name: 'order.created', mode: 'webhook', subscriber: expect.objectContaining({ sub: 'ada' }) },
      'unsubscribed',
    );
  });

  it('succeeds again for a subscription that is already gone, without telling the event twice', async () => {
    await subscribe({ arguments: { status: 'twice' } });
    await unsubscribe({ arguments: { status: 'twice' } });
    onUnsubscribe.mockClear();

    await expect(unsubscribe({ arguments: { status: 'twice' } })).resolves.toEqual({});
    expect(onUnsubscribe).not.toHaveBeenCalled();
  });

  it('finds the subscription whatever the order of the argument keys, and whatever unknown keys are sent', async () => {
    const id = await subscribe({ arguments: { status: 'paid', region: 'eu' } });

    await unsubscribe({ arguments: { region: 'eu', status: 'paid', unknown: 'dropped' } });

    await expect(subscriptions().store.get(id)).resolves.toBeUndefined();
  });

  it.each([
    ['of another caller', { arguments: { status: 'kept' }, ctx: asBob }],
    ['to another callback', { arguments: { status: 'kept' }, url: 'https://hooks.example.com/other' }],
    ['with other arguments', { arguments: { status: 'other' } }],
    ['with arguments the event refuses', { arguments: { status: 7 } }],
    ['to an event the server does not have', { name: 'order.refunded', arguments: { status: 'kept' } }],
  ])('leaves a subscription alone for a request %s', async (_label, overrides) => {
    const id = await subscribe({ arguments: { status: 'kept' } });

    await expect(unsubscribe(overrides)).resolves.toEqual({});

    await expect(subscriptions().store.get(id)).resolves.toBeDefined();
    expect(onUnsubscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['an anonymous caller', { authInfo: { user: { sub: 'anon:1f6c' } }, surface: 'mcp' }, -32024],
    ['a request without context', undefined, -32024],
    [
      'an anonymous caller detected as OpenAI',
      { authInfo: { sessionId: 'anonymous', sessionIdPayload: { platformType: 'openai' } }, surface: 'mcp' },
      -32012,
    ],
  ])('answers %s with Forbidden', async (_label, ctx, jsonRpcCode) => {
    const refusal = unsubscribe({ ctx });

    await expect(refusal).rejects.toThrow(EventForbiddenError);
    await expect(refusal).rejects.toMatchObject({ jsonRpcCode });
  });

  it('runs the hooks of a plugin', async () => {
    await unsubscribe({ arguments: { status: 'hooked' } });

    expect(removals).toHaveBeenCalledWith('order.created');
  });
});
