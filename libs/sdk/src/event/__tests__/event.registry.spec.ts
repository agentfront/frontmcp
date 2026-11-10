import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Event, event, EventContext, Provider, type FrontMcpConfigInput } from '../../common';
import { AuthConfigurationError, EventNameConflictError } from '../../errors';
import { type Scope } from '../../scope/scope.instance';
import { registerEventCapabilities } from '../event-scope.helper';
import EventRegistry from '../event.registry';

const payloadSchema = { id: z.string() };
const configDefaults = {
  compat: 'auto',
  subscriptions: {
    defaultTtlMs: 3_600_000,
    maxTtlMs: 86_400_000,
    minTtlMs: 60_000,
    allowNoExpiry: false,
    maxPerPrincipal: 100,
    reauthorizeEveryMs: 300_000,
    suspendedTtlMs: 604_800_000,
  },
  webhook: {
    enabled: true,
    allowedCallbacks: [],
    unsafeAllowLocalCallbacks: false,
    verification: { cacheTtlMs: 3_600_000, timeoutMs: 10_000 },
    delivery: {
      timeoutMs: 10_000,
      maxAttempts: 5,
      retryWindowMs: 900_000,
      backoffMs: 1_000,
      maxBackoffMs: 60_000,
      concurrency: 16,
    },
    rotationGraceMs: 300_000,
  },
  publishEndpoint: { enabled: false, path: '/events/publish' },
  buffer: { maxAgeMs: 600_000, maxEvents: 10_000 },
  poll: { enabled: false, nextPollMs: 30_000, maxEvents: 100 },
  push: { enabled: false, heartbeatMs: 25_000 },
  bridge: true,
};

@Provider({ name: 'order-book' })
class OrderBook {}

@Provider({ name: 'ledger' })
class Ledger {}

@Event({ name: 'order.created', payloadSchema })
class OrderCreated extends EventContext {}

@Event({ name: 'order.polled', payloadSchema, delivery: ['poll'] })
class OrderPolled extends EventContext {}

const invoicePaid = event({ name: 'invoice.paid', payloadSchema, delivery: ['webhook', 'push'] });

@App({ id: 'orders', name: 'Orders', providers: [OrderBook], events: [OrderCreated, OrderPolled] })
class OrdersApp {}

@App({ id: 'billing', name: 'Billing', providers: [Ledger], events: [invoicePaid, OrderCreated] })
class BillingApp {}

async function startScope(config: Partial<FrontMcpConfigInput>): Promise<Scope> {
  const { instance } = await createTestFetchServer({
    info: { name: 'event-registry', version: '1.0.0' },
    apps: [],
    ...config,
    events: { poll: { enabled: false }, push: { enabled: false }, ...config.events },
  });
  return instance.getScopes()[0] as Scope;
}

function registryOf(scope: Scope): EventRegistry {
  if (!scope.events) throw new Error('the scope has no event registry');
  return scope.events;
}

describe('EventRegistry', () => {
  describe('events declared on apps', () => {
    let scope: Scope;

    beforeAll(async () => {
      scope = await startScope({ apps: [OrdersApp, BillingApp] });
    });

    afterAll(async () => {
      await scope.dispose();
    });

    it('holds the events of every app, a class two apps list once', () => {
      const registry = registryOf(scope);

      expect(registry.hasAny()).toBe(true);
      expect(
        registry
          .getEvents()
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(['invoice.paid', 'order.created', 'order.polled']);
      expect(registry.findByName('invoice.paid')?.metadata.delivery).toEqual(['webhook', 'push']);
      expect(registry.findByName('order.unknown')).toBeUndefined();
    });

    it('runs each event with the providers of the app that declares it', () => {
      const registry = registryOf(scope);

      expect(registry.findByName('order.polled')?.create({}).get(OrderBook)).toBeInstanceOf(OrderBook);
      expect(registry.findByName('invoice.paid')?.create({}).get(Ledger)).toBeInstanceOf(Ledger);
      expect(registry.findByName('invoice.paid')?.create({}).tryGet(OrderBook)).toBeUndefined();
    });

    it('applies the defaults of the events configuration', () => {
      expect(registryOf(scope).config).toEqual(configDefaults);
    });

    it("runs an event no app's providers are given for with its own providers", async () => {
      const standalone = event({ name: 'server.started', payloadSchema });
      const registry = new EventRegistry(
        scope.providers,
        [standalone],
        registryOf(scope).owner,
        registryOf(scope).config,
        new Map(),
      );
      await registry.ready;

      expect(registry.findByName('server.started')?.providers).toBe(scope.providers);
    });
  });

  describe('turning events on and off', () => {
    it('has no registry when no app declares an event', async () => {
      @App({ id: 'plain', name: 'Plain' })
      class PlainApp {}
      const scope = await startScope({ apps: [PlainApp] });

      expect(scope.events).toBeUndefined();
      await scope.dispose();
    });

    it('has an empty registry with events.enabled: true and no event', async () => {
      const scope = await startScope({ events: { enabled: true, compat: 'sketch' } });

      expect(registryOf(scope).hasAny()).toBe(false);
      expect(registryOf(scope).getEvents()).toEqual([]);
      expect(registryOf(scope).config).toEqual({ ...configDefaults, enabled: true, compat: 'sketch' });
      expect(registryOf(scope).servesEvents()).toBe(false);
      await scope.dispose();
    });

    it('has no registry with events.enabled: false', async () => {
      const scope = await startScope({ apps: [OrdersApp], events: { enabled: false } });

      expect(scope.events).toBeUndefined();
      await scope.dispose();
    });

    it('warns that the declared events are not served with events.enabled: false', async () => {
      const logger = { warn: jest.fn(), info: jest.fn() };
      const untouched = new Proxy(
        {},
        {
          get: (_target, property) => {
            throw new Error(`events are disabled, yet ${String(property)} was read`);
          },
        },
      );

      const result = await registerEventCapabilities({
        providers: untouched as never,
        owner: untouched as never,
        eventsList: [OrderCreated, invoicePaid],
        eventProviders: new Map(),
        eventsConfig: { enabled: false },
        logger: logger as never,
      });

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Events are disabled (events.enabled: false), so the 2 event(s) apps declare are not served. ' +
          'Remove events.enabled: false to serve them.',
      );
    });
  });

  describe('event names', () => {
    it('fails startup when two events declare the same name', async () => {
      const duplicate = event({ name: 'order.created', payloadSchema });
      @App({ id: 'copies', name: 'Copies', events: [OrderCreated, duplicate] })
      class CopiesApp {}

      const startup = startScope({ apps: [CopiesApp] });

      await expect(startup).rejects.toThrow(EventNameConflictError);
      await expect(startup).rejects.toThrow(
        'Event "order.created" is declared twice: each event of a server needs its own name.',
      );
    });

    it('fails startup when events of two apps declare the same name', async () => {
      const duplicate = event({ name: 'invoice.paid', payloadSchema });
      @App({ id: 'refunds', name: 'Refunds', events: [duplicate] })
      class RefundsApp {}

      await expect(startScope({ apps: [BillingApp, RefundsApp] })).rejects.toThrow(EventNameConflictError);
    });

    it('does not register an event availableWhen excludes, so its name stays free', async () => {
      const browserVariant = event({
        name: 'file.changed',
        description: 'browser',
        payloadSchema,
        availableWhen: { runtime: ['browser'] },
      });
      const nodeVariant = event({ name: 'file.changed', description: 'node', payloadSchema });
      const browserOnly = event({ name: 'tab.closed', payloadSchema, availableWhen: { runtime: ['browser'] } });
      @App({ id: 'files', name: 'Files', events: [browserVariant, nodeVariant, browserOnly] })
      class FilesApp {}

      const scope = await startScope({ apps: [FilesApp] });

      expect(registryOf(scope).findByName('file.changed')?.metadata.description).toBe('node');
      expect(registryOf(scope).findByName('tab.closed')).toBeUndefined();
      expect(registryOf(scope).getEvents()).toHaveLength(1);
      await scope.dispose();
    });
  });

  describe('delivery modes', () => {
    let scope: Scope;
    let registry: EventRegistry;

    function modesOf(name: string): string[] {
      const found = registry.findByName(name);
      if (!found) throw new Error(`event ${name} is not registered`);
      return registry.deliveryModesOf(found);
    }

    function servedNames(): string[] {
      return registry
        .getServedEvents()
        .map(({ event: served }) => served.name)
        .sort();
    }

    beforeAll(async () => {
      scope = await startScope({ apps: [OrdersApp, BillingApp] });
      registry = registryOf(scope);
    });

    afterAll(async () => {
      await scope.dispose();
    });

    it('offers no event while no delivery mode is enabled', () => {
      expect(modesOf('order.created')).toEqual([]);
      expect(registry.getServedEvents()).toEqual([]);
      expect(registry.servesEvents()).toBe(false);
      expect(registry.getCapabilities()).toEqual({});
    });

    it('offers an enabled mode to the events whose delivery allows it', () => {
      registry.enableDeliveryMode('webhook');

      expect(modesOf('order.created')).toEqual(['webhook']);
      expect(modesOf('invoice.paid')).toEqual(['webhook']);
      expect(modesOf('order.polled')).toEqual([]);
      expect(servedNames()).toEqual(['invoice.paid', 'order.created']);
      expect(registry.servesEvents()).toBe(true);
    });

    it('advertises the capability top-level and as the SEP-3415 extension once an event is served', () => {
      expect(registry.getCapabilities()).toEqual({
        events: {},
        extensions: { 'io.modelcontextprotocol/events': {} },
      });
    });

    it('lists the modes of an event in a fixed order, each once', () => {
      registry.enableDeliveryMode('push');
      registry.enableDeliveryMode('poll');
      registry.enableDeliveryMode('poll');

      expect(modesOf('order.created')).toEqual(['poll', 'push', 'webhook']);
      expect(modesOf('invoice.paid')).toEqual(['push', 'webhook']);
      expect(modesOf('order.polled')).toEqual(['poll']);
      expect(servedNames()).toEqual(['invoice.paid', 'order.created', 'order.polled']);
      expect(registry.getServedEvents().find(({ event: served }) => served.name === 'order.polled')?.delivery).toEqual([
        'poll',
      ]);
    });
  });

  describe('authorities', () => {
    const guarded = event({ name: 'payroll.run', payloadSchema, authorities: { roles: { any: ['finance'] } } });

    it('fails startup when an event declares authorities the server does not enforce', async () => {
      @App({ id: 'payroll', name: 'Payroll', events: [guarded, OrderCreated] })
      class PayrollApp {}

      const startup = startScope({ apps: [PayrollApp] });

      await expect(startup).rejects.toThrow(AuthConfigurationError);
      await expect(startup).rejects.toThrow(/Authorities configuration required: Event "payroll.run" declare/);
    });

    it('fails startup on an event whose rule checks nothing', async () => {
      const unchecked = event({ name: 'payroll.audit', payloadSchema, authorities: {} });
      @App({ id: 'audit', name: 'Audit', events: [unchecked] })
      class AuditApp {}

      await expect(startScope({ apps: [AuditApp], authorities: {} })).rejects.toThrow(
        /Invalid authorities rule: Event "payroll.audit": authorities/,
      );
    });

    it('starts when the server enforces the authorities its events declare', async () => {
      @App({ id: 'payroll', name: 'Payroll', events: [guarded] })
      class PayrollApp {}

      const scope = await startScope({ apps: [PayrollApp], authorities: {} });

      expect(registryOf(scope).findByName('payroll.run')?.getAuthorities()).toEqual({ roles: { any: ['finance'] } });
      await scope.dispose();
    });
  });
});
