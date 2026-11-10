import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type ListEventsResult } from '@frontmcp/protocol';

import { runFlowStages } from '../../__test-utils__';
import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  Event,
  event,
  EventContext,
  FrontMcpFlowTokens,
  Plugin,
  type EventType,
  type FlowCtxOf,
  type FlowMetadata,
  type FrontMcpConfigInput,
} from '../../common';
import { InvalidInputError } from '../../errors';
import { ListEventsHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import ListEventsFlow, { EVENTS_LIST_PAGE_SIZE } from '../flows/list-events.flow';

const payloadSchema = { id: z.string() };
const admin = { sessionId: 'admin-session', user: { sub: 'ada', roles: ['admin'] } };
const member = { sessionId: 'member-session', user: { sub: 'bob', roles: ['member'] } };
const asMember = { authInfo: member, surface: 'mcp' };
const asAdmin = { authInfo: admin, surface: 'mcp' };

const policyStoreDown = (): boolean => {
  throw new Error('policy store down');
};

@Event({
  name: 'order.created',
  description: 'Fires when an order is placed',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string(), total: z.number() },
})
class OrderCreated extends EventContext {}

const orderShipped = event({ name: 'order.shipped', payloadSchema });
const auditLogged = event({ name: 'audit.logged', payloadSchema, authorities: 'admin' });
const brokenPolicy = event({ name: 'broken.policy', payloadSchema, authorities: { guards: [policyStoreDown] } });
const internalTick = event({ name: 'internal.tick', payloadSchema, hideFromDiscovery: true });
const agentNote = event({ name: 'agent.note', payloadSchema, availableWhen: { surface: ['agent'] } });
const pollOnly = event({ name: 'poll.only', payloadSchema, delivery: ['poll'] });
const pushOrWebhook = event({ name: 'push.or-webhook', payloadSchema, delivery: ['push', 'webhook'] });

async function startScope(events: EventType[], extra: Partial<FrontMcpConfigInput> = {}): Promise<Scope> {
  @App({ id: 'shop', name: 'Shop', events })
  class ShopApp {}
  const { instance } = await createTestFetchServer({
    info: { name: 'list-events-flow', version: '1.0.0' },
    apps: [ShopApp],
    authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
    events: { poll: { enabled: false }, push: { enabled: false } },
    ...extra,
  });
  return instance.getScopes()[0] as Scope;
}

function list(scope: Scope, ctx: unknown = asMember, cursor?: string | null): Promise<ListEventsResult> {
  const request = { method: 'events/list' as const, ...(cursor !== undefined && { params: { cursor } }) };
  return scope.runFlowForOutput('events:list', { request, ctx });
}

async function listedNames(scope: Scope, ctx?: unknown): Promise<string[]> {
  return (await list(scope, ctx)).events.map((definition) => definition.name);
}

describe('events:list', () => {
  describe('what it lists', () => {
    let scope: Scope;

    beforeAll(async () => {
      scope = await startScope([
        orderShipped,
        OrderCreated,
        auditLogged,
        brokenPolicy,
        internalTick,
        agentNote,
        pollOnly,
        pushOrWebhook,
      ]);
    });

    afterAll(async () => {
      await scope.dispose();
    });

    it('lists nothing while the server performs no delivery mode', async () => {
      await expect(list(scope)).resolves.toEqual({ events: [] });
    });

    it('describes each event with its delivery modes and JSON Schemas, ordered by name', async () => {
      scope.events?.enableDeliveryMode('webhook');

      const result = await list(scope);

      expect(result.nextCursor).toBeUndefined();
      expect(result.events).toEqual([
        {
          name: 'order.created',
          description: 'Fires when an order is placed',
          delivery: ['webhook'],
          inputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { status: { type: 'string' } },
          },
          payloadSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { orderId: { type: 'string' }, total: { type: 'number' } },
            required: ['orderId', 'total'],
            additionalProperties: false,
          },
        },
        {
          name: 'order.shipped',
          delivery: ['webhook'],
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          payloadSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
          },
        },
        expect.objectContaining({ name: 'push.or-webhook', delivery: ['webhook'] }),
      ]);
    });

    it('leaves out an event whose delivery modes the server does not perform', async () => {
      expect(await listedNames(scope)).not.toContain('poll.only');

      scope.events?.enableDeliveryMode('poll');

      const result = await list(scope);
      const deliveryOf = (name: string) => result.events.find((definition) => definition.name === name)?.delivery;
      expect(deliveryOf('poll.only')).toEqual(['poll']);
      expect(deliveryOf('order.created')).toEqual(['poll', 'webhook']);
      expect(deliveryOf('push.or-webhook')).toEqual(['webhook']);
    });

    it('hides an event from a caller its authorities refuse', async () => {
      expect(await listedNames(scope, asMember)).not.toContain('audit.logged');
      expect(await listedNames(scope, { authInfo: {} })).not.toContain('audit.logged');
      expect(await listedNames(scope, {})).not.toContain('audit.logged');
      expect(await listedNames(scope, undefined)).not.toContain('audit.logged');
      expect(await listedNames(scope, asAdmin)).toContain('audit.logged');
    });

    it('leaves out only the event whose policy throws', async () => {
      expect(await listedNames(scope, asAdmin)).toEqual([
        'audit.logged',
        'order.created',
        'order.shipped',
        'poll.only',
        'push.or-webhook',
      ]);
    });

    it('leaves out an event declared with hideFromDiscovery', async () => {
      expect(scope.events?.findByName('internal.tick')).toBeDefined();
      expect(await listedNames(scope, asAdmin)).not.toContain('internal.tick');
    });

    it('lists an event only on the surfaces its availableWhen names', async () => {
      expect(await listedNames(scope, asMember)).not.toContain('agent.note');
      expect(await listedNames(scope, { authInfo: member, surface: 'agent' })).toContain('agent.note');
      expect(await listedNames(scope, { authInfo: member })).toContain('agent.note');
    });
  });

  describe('without an authorities engine', () => {
    it('lists every served event', async () => {
      const scope = await startScope([OrderCreated, orderShipped], { authorities: undefined });
      scope.events?.enableDeliveryMode('push');

      expect(await listedNames(scope, {})).toEqual(['order.created', 'order.shipped']);
      await scope.dispose();
    });
  });

  describe('pagination', () => {
    const EVENT_COUNT = EVENTS_LIST_PAGE_SIZE + 5;
    const manyEvents = Array.from({ length: EVENT_COUNT }, (_unused, index) =>
      event({ name: `event.${String(EVENT_COUNT - index).padStart(3, '0')}`, payloadSchema }),
    );
    const secondPageCursor = Buffer.from(JSON.stringify({ offset: EVENTS_LIST_PAGE_SIZE })).toString('base64');
    let scope: Scope;

    beforeAll(async () => {
      scope = await startScope(manyEvents);
      scope.events?.enableDeliveryMode('webhook');
    });

    afterAll(async () => {
      await scope.dispose();
    });

    it('answers the first page with a base64 JSON offset cursor, as tools/list does', async () => {
      const page = await list(scope);

      expect(page.events).toHaveLength(EVENTS_LIST_PAGE_SIZE);
      expect(page.events[0].name).toBe('event.001');
      expect(page.nextCursor).toBe(secondPageCursor);
    });

    it('treats a null cursor as the first page', async () => {
      const page = await list(scope, asMember, null);

      expect(page.events[0].name).toBe('event.001');
      expect(page.nextCursor).toBe(secondPageCursor);
    });

    it('answers the rest on the last page, in name order across pages', async () => {
      const first = await list(scope);
      const last = await list(scope, asMember, first.nextCursor);
      const names = [...first.events, ...last.events].map((definition) => definition.name);

      expect(last.events).toHaveLength(5);
      expect(last.nextCursor).toBeUndefined();
      expect(names).toEqual([...names].sort());
      expect(new Set(names).size).toBe(EVENT_COUNT);
    });

    it('answers an empty page for a cursor at the end of the list', async () => {
      const atEnd = Buffer.from(JSON.stringify({ offset: EVENT_COUNT })).toString('base64');

      await expect(list(scope, asMember, atEnd)).resolves.toEqual({ events: [] });
    });

    it('refuses a cursor it did not issue', async () => {
      const pastEnd = Buffer.from(JSON.stringify({ offset: EVENT_COUNT + 1 })).toString('base64');
      const negative = Buffer.from(JSON.stringify({ offset: -1 })).toString('base64');

      await expect(list(scope, asMember, 'not a cursor')).rejects.toThrow(InvalidInputError);
      await expect(list(scope, asMember, negative)).rejects.toThrow(/non-negative integer/);
      await expect(list(scope, asMember, pastEnd)).rejects.toThrow(
        `Invalid pagination cursor: offset ${EVENT_COUNT + 1} exceeds total event count ${EVENT_COUNT}`,
      );
    });
  });

  describe('hooks', () => {
    it('lets a plugin shape the list for the caller', async () => {
      @Plugin({ name: 'event-visibility' })
      class EventVisibilityPlugin {
        @ListEventsHook.Did('findEvents')
        hideShipped(ctx: FlowCtxOf<'events:list'>) {
          const visible = ctx.state.required.events.filter(({ event: found }) => found.name !== 'order.shipped');
          ctx.state.set('events', visible);
        }
      }
      const scope = await startScope([OrderCreated, orderShipped], { plugins: [EventVisibilityPlugin] });
      scope.events?.enableDeliveryMode('webhook');

      expect(await listedNames(scope)).toEqual(['order.created']);
      await scope.dispose();
    });
  });

  describe('with events.enabled: false', () => {
    it('is not registered', async () => {
      const scope = await startScope([OrderCreated], { events: { enabled: false } });

      await expect(list(scope)).rejects.toThrow();
      await scope.dispose();
    });
  });

  describe('on a scope without events', () => {
    it('finds none', async () => {
      const metadata = {
        name: 'events:list',
        inputSchema: Reflect.getMetadata(FrontMcpFlowTokens.inputSchema, ListEventsFlow),
        outputSchema: Reflect.getMetadata(FrontMcpFlowTokens.outputSchema, ListEventsFlow),
        plan: Reflect.getMetadata(FrontMcpFlowTokens.plan, ListEventsFlow),
      } as FlowMetadata<'events:list'>;
      const logger = { child: () => logger };
      const scopeWithoutEvents = { logger, events: undefined } as unknown as Scope;
      const input = { request: { method: 'events/list' }, ctx: {} };
      const flow = new ListEventsFlow(metadata, input, scopeWithoutEvents, jest.fn());

      const { output } = await runFlowStages(flow, ['parseInput', 'findEvents', 'filterByAvailability', 'parseEvents']);

      expect(output).toEqual({ events: [] });
    });
  });
});
