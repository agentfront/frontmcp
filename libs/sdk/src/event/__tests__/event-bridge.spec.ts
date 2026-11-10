/**
 * The bridge from events to what already listens on the scope's event bus: each published event is emitted there
 * once, under its name, so a `trigger: 'event'` workflow and an `app-event` channel react to it.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { generateStandardWebhookSecret } from '@frontmcp/utils';

import {
  App,
  Channel,
  ChannelContext,
  event,
  Job,
  JobContext,
  LogLevel,
  Plugin,
  Workflow,
  type ChannelNotification,
  type EventSubscriber,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { EventPublishHook } from '../../index';
import { jobExecutionManagerOf } from '../../job/job-run-access';
import { type Scope } from '../../scope/scope.instance';
import { type EventSubscriptionRecord } from '../subscription/event-subscription.store';

const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string() } });
const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });

const auditedByWorkflow: Array<Record<string, unknown>> = [];
const heardByChannel: unknown[] = [];
const bridged = jest.fn();
let vetoedEvent: string | undefined;

const occurrenceShape = {
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: z.object({ orderId: z.string() }),
};
type Occurrence = z.infer<z.ZodObject<typeof occurrenceShape>>;

@Job({ name: 'audit-order', inputSchema: occurrenceShape, outputSchema: {} })
class AuditOrderJob extends JobContext {
  async execute(occurrence: Occurrence) {
    auditedByWorkflow.push(occurrence);
    return {};
  }
}

@Workflow({
  name: 'audit-orders',
  trigger: 'event',
  event: 'order.created',
  inputSchema: occurrenceShape,
  steps: [{ id: 'audit', jobName: 'audit-order' }],
})
class AuditOrdersWorkflow {}

@Channel({
  name: 'orders',
  description: 'Orders as they are placed',
  source: { type: 'app-event', event: 'order.created' },
})
class OrdersChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    heardByChannel.push(payload);
    return { content: 'an order was placed' };
  }
}

/** Observes the bridge stage, and skips it for the event a test names. */
@Plugin({ name: 'bridge-watch' })
class BridgeWatchPlugin {
  @EventPublishHook.Around('bridgeToBus')
  async vetoOne(ctx: FlowCtxOf<'events:publish'>, next: () => Promise<unknown>) {
    if (ctx.rawInput.occurrence.name === vetoedEvent) return;
    await next();
  }

  @EventPublishHook.Did('bridgeToBus')
  observe(ctx: FlowCtxOf<'events:publish'>) {
    bridged(ctx.rawInput.occurrence.eventId);
  }
}

@App({
  id: 'shop',
  name: 'Shop',
  events: [orderCreated, orderShipped],
  jobs: [AuditOrderJob],
  workflows: [AuditOrdersWorkflow],
  channels: [OrdersChannel],
})
class ShopApp {}

@App({ id: 'plain', name: 'Plain', events: [orderCreated] })
class AppWithoutListeners {}

const quiet = { level: LogLevel.Off, enableConsole: false };

/** Starts a server of the shop app, with channels on so the scope has an event bus. */
async function serve(extra: Partial<FrontMcpConfigInput> = {}): Promise<FrontMcpInstance> {
  return FrontMcpInstance.createForGraph({
    info: { name: 'event-bridge', version: '1.0.0' },
    apps: [ShopApp],
    plugins: [BridgeWatchPlugin],
    channels: { enabled: true },
    jobs: { enabled: true },
    logging: quiet,
    ...extra,
  });
}

/** The publisher of a server's scope. */
function publisherOf(instance: FrontMcpInstance) {
  const publisher = (instance.getPrimaryScope() as Scope).events?.publisher;
  if (!publisher) throw new Error('the scope has no publisher');
  return publisher;
}

/** Waits until a condition holds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('the events bridge', () => {
  let instance: FrontMcpInstance;
  let scope: Scope;
  const heardOnBus: unknown[] = [];
  let stopListening: (() => void) | undefined;

  beforeAll(async () => {
    instance = await serve({ auth: { mode: 'local' } as never });
    scope = instance.getPrimaryScope() as Scope;
    stopListening = scope.channelEventBus?.on('order.created', (payload) => heardOnBus.push(payload));
  });

  afterAll(async () => {
    stopListening?.();
    await instance.shutdown();
  });

  beforeEach(() => {
    auditedByWorkflow.length = 0;
    heardByChannel.length = 0;
    heardOnBus.length = 0;
    vetoedEvent = undefined;
    jest.clearAllMocks();
  });

  it('emits a published event on the bus under its name, as the occurrence, also when nobody is subscribed', async () => {
    const { eventId, matched } = await publisherOf(instance).publish(orderCreated, { orderId: 'o-1' });

    expect(matched).toBe(0);
    expect(heardOnBus).toEqual([
      { eventId, name: 'order.created', timestamp: expect.stringMatching(/Z$/), data: { orderId: 'o-1' } },
    ]);
  });

  it('starts the workflow that listens to the event with the occurrence as its input, and the channel hears it', async () => {
    const { eventId } = await publisherOf(instance).publish(orderCreated, { orderId: 'o-2' });

    await until(() => auditedByWorkflow.length === 1 && heardByChannel.length === 1);
    const occurrence = { eventId, name: 'order.created', timestamp: expect.any(String), data: { orderId: 'o-2' } };
    expect(auditedByWorkflow).toEqual([occurrence]);
    expect(heardByChannel).toEqual([occurrence]);
    const runs = (await jobExecutionManagerOf(scope)?.listRuns()) ?? [];
    expect(runs.map((run) => run.jobName)).toContain('audit-orders');
  });

  it('emits once for a publish, however many subscriptions receive the event', async () => {
    const store = scope.events?.subscriptions?.store;
    if (!store) throw new Error('the scope keeps no subscriptions');
    const subscriber: EventSubscriber = { sub: 'ada', roles: [], permissions: [], scopes: [], claims: {} };
    const now = Date.now();
    const subscription = (id: string): EventSubscriptionRecord => ({
      id,
      principalKey: 'principal:ada',
      subscriber,
      eventName: 'order.created',
      arguments: {},
      argumentsKey: id,
      delivery: { mode: 'webhook', url: 'https://hooks.example.com/mcp', secret: generateStandardWebhookSecret() },
      dialect: 'sep-3415',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60_000,
      verifiedAt: now,
      lastAuthorizedAt: now,
      active: true,
      status: {},
    });
    await store.upsert(subscription('sub_0001'));
    await store.upsert(subscription('sub_0002'));
    jest.spyOn(scope.events?.outbox as object as { enqueue: () => Promise<void> }, 'enqueue').mockResolvedValue();

    const { matched } = await publisherOf(instance).publish(orderCreated, { orderId: 'o-3' });

    expect(matched).toBe(2);
    expect(heardOnBus).toHaveLength(1);
    await store.delete('sub_0001');
    await store.delete('sub_0002');
    jest.restoreAllMocks();
  });

  it('emits an event nothing listens to without an error', async () => {
    await expect(publisherOf(instance).publish(orderShipped, { orderId: 'o-4' })).resolves.toMatchObject({
      matched: 0,
    });
    expect(heardOnBus).toEqual([]);
  });

  it('is a stage a hook observes, and skips with an Around hook that does not go on', async () => {
    const first = await publisherOf(instance).publish(orderCreated, { orderId: 'o-5' });
    vetoedEvent = 'order.created';
    const vetoed = await publisherOf(instance).publish(orderCreated, { orderId: 'o-6' });

    expect(bridged).toHaveBeenCalledWith(first.eventId);
    expect(vetoed.eventId).toMatch(/^evt_/);
    expect(heardOnBus).toHaveLength(1);
  });

  it('does not emit when publishing fails before the event is queued', async () => {
    await expect(publisherOf(instance).publish('order.created', { orderId: 7 } as never)).rejects.toThrow(
      'its data does not match payloadSchema',
    );

    expect(heardOnBus).toEqual([]);
  });
});

describe('the events bridge, switched off or without a bus', () => {
  it('emits nothing with events.bridge: false', async () => {
    const instance = await serve({ events: { bridge: false } });
    const scope = instance.getPrimaryScope() as Scope;
    const heard: unknown[] = [];
    scope.channelEventBus?.on('order.created', (payload) => heard.push(payload));

    await publisherOf(instance).publish(orderCreated, { orderId: 'o-8' });

    expect(scope.events?.config.bridge).toBe(false);
    expect(heard).toEqual([]);
    await instance.shutdown();
  });

  it('publishes on a server that has no event bus', async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'event-bridge-no-bus', version: '1.0.0' },
      apps: [AppWithoutListeners],
      logging: quiet,
    });
    const scope = instance.getPrimaryScope() as Scope;

    expect(scope.channelEventBus).toBeUndefined();
    expect(scope.events?.config.bridge).toBe(true);
    await expect(publisherOf(instance).publish(orderCreated, { orderId: 'o-9' })).resolves.toMatchObject({
      matched: 0,
    });
    await instance.shutdown();
  });
});
