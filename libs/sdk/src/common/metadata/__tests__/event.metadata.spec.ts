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

  it('defaults compat to auto', () => {
    expect(eventsConfigSchema.parse({})).toEqual({ compat: 'auto' });
    expect(eventsConfigSchema.parse({ enabled: false, compat: 'sketch' })).toEqual({
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
      enabled: true,
      compat: 'auto',
    });
    expect(frontMcpMetadataSchema.parse(server).events).toBeUndefined();
    expect(frontMcpMetadataSchema.safeParse({ ...server, events: { compat: 'legacy' } }).success).toBe(false);
  });

  it('is kept by the CLI configuration parser', () => {
    expect(parseFrontMcpConfigLite({ ...server, events: { compat: 'sketch' } }).events).toEqual({ compat: 'sketch' });
    expect(() => parseFrontMcpConfigLite({ ...server, events: { compat: 'legacy' } } as never)).toThrow();
  });
});
