import { z } from '@frontmcp/lazy-zod';

import { EVENT_NAME_MAX_LENGTH, eventsConfigSchema, frontMcpEventMetadataSchema } from '../event.metadata';
import { frontMcpMetadataSchema, parseFrontMcpConfigLite } from '../front-mcp.metadata';

const payloadSchema = { orderId: z.string() };

function parse(metadata: Record<string, unknown>) {
  return frontMcpEventMetadataSchema.safeParse({ name: 'order.created', payloadSchema, ...metadata });
}

function messagesOf(metadata: Record<string, unknown>): string[] {
  return parse(metadata).error?.issues.map((issue) => issue.message) ?? [];
}

describe('event metadata', () => {
  describe('name', () => {
    it.each([
      ['order.created'],
      ['billing/invoice.paid'],
      ['a'],
      ['x'.repeat(EVENT_NAME_MAX_LENGTH)],
      ['commande.créée'],
    ])('accepts %p', (name) => {
      expect(parse({ name }).success).toBe(true);
    });

    it('refuses an empty name', () => {
      expect(messagesOf({ name: '' })).toContain('An event name must not be empty');
    });

    it('refuses a name longer than 128 characters', () => {
      expect(messagesOf({ name: 'x'.repeat(EVENT_NAME_MAX_LENGTH + 1) })).toEqual([
        'An event name must be at most 128 characters',
      ]);
    });

    it.each([['order created'], ['order\tcreated'], ['order.created\n'], ['order\u0000created'], ['order created']])(
      'refuses %p, which has whitespace or a control character',
      (name) => {
        expect(messagesOf({ name })).toEqual(['An event name must not contain whitespace or control characters']);
      },
    );

    it('refuses a missing name', () => {
      expect(frontMcpEventMetadataSchema.safeParse({ payloadSchema }).success).toBe(false);
    });
  });

  describe('schemas', () => {
    it('accepts a raw shape, an empty raw shape and z.object() as payloadSchema', () => {
      expect(
        parse({ payloadSchema: { orderId: z.string(), lines: z.array(z.object({ sku: z.string() })) } }).success,
      ).toBe(true);
      expect(parse({ payloadSchema: {} }).success).toBe(true);
      expect(parse({ payloadSchema: z.object({ orderId: z.string() }) }).success).toBe(true);
    });

    it('requires a payloadSchema', () => {
      expect(frontMcpEventMetadataSchema.safeParse({ name: 'order.created' }).success).toBe(false);
    });

    it.each([
      ['a zod string', z.string()],
      ['a zod array', z.array(z.object({ id: z.string() }))],
      ['a literal', 'string'],
      ['an array', [z.string()]],
      ['a shape with a field that is not a zod schema', { orderId: 'string' }],
      ['null', null],
    ])('refuses %s as payloadSchema', (_label, schema) => {
      expect(messagesOf({ payloadSchema: schema })).toEqual(['Expected a zod raw shape or z.object()']);
    });

    it('takes an optional inputSchema of the same forms', () => {
      expect(parse({}).data?.inputSchema).toBeUndefined();
      expect(parse({ inputSchema: { status: z.string().optional() } }).success).toBe(true);
      expect(parse({ inputSchema: z.object({ status: z.string() }) }).success).toBe(true);
      expect(messagesOf({ inputSchema: z.number() })).toEqual(['Expected a zod raw shape or z.object()']);
    });

    it('keeps the schemas it was given', () => {
      const inputSchema = { status: z.string() };

      const metadata = parse({ inputSchema }).data;

      expect(metadata?.inputSchema).toBe(inputSchema);
      expect(metadata?.payloadSchema).toBe(payloadSchema);
    });
  });

  describe('delivery', () => {
    it('restricts the event to delivery modes', () => {
      expect(parse({ delivery: ['webhook'] }).data?.delivery).toEqual(['webhook']);
      expect(parse({ delivery: ['poll', 'push', 'webhook'] }).success).toBe(true);
      expect(parse({}).data?.delivery).toBeUndefined();
    });

    it('refuses an empty list and an unknown mode', () => {
      expect(messagesOf({ delivery: [] })).toEqual(['delivery must name at least one mode']);
      expect(parse({ delivery: ['email'] }).success).toBe(false);
    });
  });

  describe('other fields', () => {
    it('defaults hideFromDiscovery to false', () => {
      expect(parse({}).data?.hideFromDiscovery).toBe(false);
      expect(parse({ hideFromDiscovery: true }).data?.hideFromDiscovery).toBe(true);
    });

    it('accepts a description, tags and availableWhen', () => {
      const metadata = parse({
        description: 'Fires when an order is placed',
        tags: ['orders'],
        availableWhen: { runtime: ['node'] },
      }).data;

      expect(metadata).toMatchObject({
        description: 'Fires when an order is placed',
        tags: ['orders'],
        availableWhen: { runtime: ['node'] },
      });
      expect(parse({ tags: [''] }).success).toBe(false);
    });

    it('accepts ttl bounds in whole positive milliseconds', () => {
      expect(parse({ ttl: { defaultMs: 60_000, maxMs: 3_600_000 } }).success).toBe(true);
      expect(parse({ ttl: { maxMs: 3_600_000 } }).success).toBe(true);
      expect(parse({ ttl: {} }).success).toBe(true);
      expect(parse({ ttl: { defaultMs: 0 } }).success).toBe(false);
      expect(parse({ ttl: { maxMs: 1.5 } }).success).toBe(false);
    });

    it('refuses a default ttl longer than the maximum', () => {
      expect(messagesOf({ ttl: { defaultMs: 120_000, maxMs: 60_000 } })).toEqual([
        'ttl.defaultMs must not exceed ttl.maxMs',
      ]);
    });

    it('keeps fields other packages add, such as authorities', () => {
      expect(parse({ authorities: 'admin' }).data).toMatchObject({ authorities: 'admin' });
    });
  });
});

describe('events configuration', () => {
  const server = { info: { name: 'events-config', version: '1.0.0' }, apps: [] };
  const subscriptions = {
    defaultTtlMs: 3_600_000,
    maxTtlMs: 86_400_000,
    minTtlMs: 60_000,
    allowNoExpiry: false,
    maxPerPrincipal: 100,
    reauthorizeEveryMs: 300_000,
    suspendedTtlMs: 604_800_000,
  };
  const delivery = {
    timeoutMs: 10_000,
    maxAttempts: 5,
    retryWindowMs: 900_000,
    backoffMs: 1_000,
    maxBackoffMs: 60_000,
    concurrency: 16,
  };
  const webhook = {
    enabled: true,
    allowedCallbacks: [],
    unsafeAllowLocalCallbacks: false,
    verification: { cacheTtlMs: 3_600_000, timeoutMs: 10_000 },
    delivery,
    rotationGraceMs: 300_000,
  };
  const publishEndpoint = { enabled: false, path: '/events/publish' };
  const buffer = { maxAgeMs: 600_000, maxEvents: 10_000 };
  const poll = { enabled: true, nextPollMs: 30_000, maxEvents: 100 };
  const defaults = { compat: 'auto', subscriptions, webhook, publishEndpoint, buffer, poll };

  it('defaults compat to auto, and the subscription and webhook settings', () => {
    expect(eventsConfigSchema.parse({})).toEqual(defaults);
    expect(eventsConfigSchema.parse({ enabled: false, compat: 'sketch' })).toEqual({
      ...defaults,
      enabled: false,
      compat: 'sketch',
    });
    expect(eventsConfigSchema.parse({ compat: 'sep-3415' }).compat).toBe('sep-3415');
  });

  it('refuses an unknown compat and a non-boolean enabled', () => {
    expect(eventsConfigSchema.safeParse({ compat: 'chatgpt' }).success).toBe(false);
    expect(eventsConfigSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });

  it('is part of the @FrontMcp configuration', () => {
    expect(frontMcpMetadataSchema.parse({ ...server, events: { enabled: true } }).events).toEqual({
      ...defaults,
      enabled: true,
    });
    expect(frontMcpMetadataSchema.parse(server).events).toBeUndefined();
    expect(frontMcpMetadataSchema.safeParse({ ...server, events: { compat: 'legacy' } }).success).toBe(false);
  });

  it('is kept by the CLI configuration parser', () => {
    expect(parseFrontMcpConfigLite({ ...server, events: { compat: 'sketch' } }).events).toEqual({
      ...defaults,
      compat: 'sketch',
    });
    expect(() => parseFrontMcpConfigLite({ ...server, events: { compat: 'legacy' } } as never)).toThrow();
  });

  it('gives the same settings when its own output is parsed again', () => {
    const parsed = eventsConfigSchema.parse({ subscriptions: { maxPerPrincipal: 5 }, webhook: { enabled: false } });

    expect(eventsConfigSchema.parse(parsed)).toEqual(parsed);
  });

  describe('subscriptions', () => {
    it('keeps the lifetimes and limits a server sets', () => {
      const parsed = eventsConfigSchema.parse({
        subscriptions: {
          defaultTtlMs: 600_000,
          maxTtlMs: 1_200_000,
          minTtlMs: 30_000,
          maxPerPrincipal: 5,
          reauthorizeEveryMs: 60_000,
          suspendedTtlMs: 86_400_000,
        },
      });

      expect(parsed.subscriptions).toEqual({
        defaultTtlMs: 600_000,
        maxTtlMs: 1_200_000,
        minTtlMs: 30_000,
        allowNoExpiry: false,
        maxPerPrincipal: 5,
        reauthorizeEveryMs: 60_000,
        suspendedTtlMs: 86_400_000,
      });
    });

    it.each([
      ['a default above the maximum', { defaultTtlMs: 7_200_000, maxTtlMs: 3_600_000 }],
      ['a maximum below the built-in default', { maxTtlMs: 600_000 }],
      ['a minimum above the default', { minTtlMs: 7_200_000 }],
    ])('refuses %s, naming the three lifetimes', (_label, lifetimes) => {
      const result = eventsConfigSchema.safeParse({ subscriptions: lifetimes });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'events.subscriptions needs minTtlMs <= defaultTtlMs <= maxTtlMs; set the three together',
      );
    });

    it.each([
      ['a zero lifetime', { defaultTtlMs: 0 }],
      ['a fractional lifetime', { maxTtlMs: 1000.5 }],
      ['a limit of no subscriptions', { maxPerPrincipal: 0 }],
    ])('refuses %s', (_label, value) => {
      expect(eventsConfigSchema.safeParse({ subscriptions: value }).success).toBe(false);
    });

    it('allows subscriptions without expiry only with a store that outlives the process', () => {
      const allowNoExpiry = { subscriptions: { allowNoExpiry: true } };
      const refused = eventsConfigSchema.safeParse(allowNoExpiry);

      expect(refused.success).toBe(false);
      expect(refused.error?.issues[0].message).toBe(
        'events.subscriptions.allowNoExpiry needs events.store.redis or events.store.sqlite',
      );
      expect(
        eventsConfigSchema.safeParse({ ...allowNoExpiry, store: { sqlite: { path: 'events.sqlite' } } }).success,
      ).toBe(true);
      expect(eventsConfigSchema.safeParse({ ...allowNoExpiry, store: { redis: { host: 'localhost' } } }).success).toBe(
        true,
      );
      expect(eventsConfigSchema.safeParse({ ...allowNoExpiry, store: { keyPrefix: 'app:' } }).success).toBe(false);
    });
  });

  describe('buffer and poll', () => {
    it('keeps what a server sets, and defaults the rest', () => {
      const parsed = eventsConfigSchema.parse({
        buffer: { maxEvents: 500 },
        poll: { enabled: false, nextPollMs: 5000 },
      });

      expect(parsed.buffer).toEqual({ maxAgeMs: 600_000, maxEvents: 500 });
      expect(parsed.poll).toEqual({ enabled: false, nextPollMs: 5000, maxEvents: 100 });
    });

    it('refuses sizes and intervals that are not positive integers', () => {
      expect(eventsConfigSchema.safeParse({ buffer: { maxAgeMs: 0 } }).success).toBe(false);
      expect(eventsConfigSchema.safeParse({ buffer: { maxEvents: 1.5 } }).success).toBe(false);
      expect(eventsConfigSchema.safeParse({ poll: { nextPollMs: -1 } }).success).toBe(false);
      expect(eventsConfigSchema.safeParse({ poll: { maxEvents: 0 } }).success).toBe(false);
    });
  });

  describe('store', () => {
    it('takes a SQLite file with a path, or Redis, and a key prefix', () => {
      const parsed = eventsConfigSchema.parse({
        store: { sqlite: { path: 'events.sqlite' }, keyPrefix: 'app:events:' },
      });

      expect(parsed.store).toMatchObject({ sqlite: { path: 'events.sqlite' }, keyPrefix: 'app:events:' });
    });

    it('refuses SQLite without a path, an empty key prefix, and both backends at once', () => {
      expect(eventsConfigSchema.safeParse({ store: { sqlite: {} } }).success).toBe(false);
      expect(eventsConfigSchema.safeParse({ store: { keyPrefix: '' } }).success).toBe(false);

      const both = eventsConfigSchema.safeParse({
        store: { sqlite: { path: 'events.sqlite' }, redis: { host: 'localhost' } },
      });
      expect(both.success).toBe(false);
      expect(both.error?.issues[0].message).toBe('events.store takes redis or sqlite, not both');
    });
  });

  describe('webhook', () => {
    it('keeps what a server sets, and defaults the rest', () => {
      const parsed = eventsConfigSchema.parse({
        webhook: {
          enabled: false,
          allowedCallbacks: ['https://hooks.example.com/mcp/'],
          unsafeAllowLocalCallbacks: true,
          verification: { timeoutMs: 2000 },
          rotationGraceMs: 60_000,
        },
      });

      expect(parsed.webhook).toEqual({
        enabled: false,
        allowedCallbacks: ['https://hooks.example.com/mcp/'],
        unsafeAllowLocalCallbacks: true,
        verification: { cacheTtlMs: 3_600_000, timeoutMs: 2000 },
        delivery,
        rotationGraceMs: 60_000,
      });
    });

    it('keeps the delivery settings a server sets', () => {
      const parsed = eventsConfigSchema.parse({
        webhook: { delivery: { timeoutMs: 2000, maxAttempts: 3, backoffMs: 500, concurrency: 4 } },
      });

      expect(parsed.webhook.delivery).toEqual({
        timeoutMs: 2000,
        maxAttempts: 3,
        retryWindowMs: 900_000,
        backoffMs: 500,
        maxBackoffMs: 60_000,
        concurrency: 4,
      });
    });

    it('refuses a first wait longer than the longest wait, and no attempt at all', () => {
      const backwards = eventsConfigSchema.safeParse({
        webhook: { delivery: { backoffMs: 5000, maxBackoffMs: 1000 } },
      });

      expect(backwards.success).toBe(false);
      expect(backwards.error?.issues[0].message).toBe('events.webhook.delivery needs backoffMs <= maxBackoffMs');
      expect(eventsConfigSchema.safeParse({ webhook: { delivery: { maxAttempts: 0 } } }).success).toBe(false);
    });

    it('refuses an allowed callback that is not a URL, and durations that are not positive', () => {
      expect(eventsConfigSchema.safeParse({ webhook: { allowedCallbacks: ['/hooks/'] } }).success).toBe(false);
      expect(eventsConfigSchema.safeParse({ webhook: { rotationGraceMs: 0 } }).success).toBe(false);
      expect(eventsConfigSchema.safeParse({ webhook: { verification: { cacheTtlMs: -1 } } }).success).toBe(false);
    });
  });
});
