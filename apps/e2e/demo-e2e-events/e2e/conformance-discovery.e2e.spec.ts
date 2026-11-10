/**
 * Conformance of discovery (MCP Events, SEP-3415): the capability, `events/list` and its descriptors, the gated
 * list-change filter, and the answer of a server without the extension. See CONFORMANCE.md for the rows each covers.
 */
import { expect, type McpTestClient } from '@frontmcp/testing';

import { ConformanceServer, EVENTS_EXTENSION, PROTOCOL_PATHS, type ProtocolPath } from './conformance.helpers';

interface Descriptor {
  name: string;
  description?: string;
  delivery: string[];
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  _meta?: unknown;
}

/** The capabilities a client learned: from `initialize`, or from `server/discover` under 2026-07-28. */
async function capabilitiesOf(client: McpTestClient, path: ProtocolPath): Promise<Record<string, unknown>> {
  const capabilities = path === '2026-07-28' ? (await client.discover()).capabilities : client.capabilities;
  return capabilities as Record<string, unknown>;
}

describe('Events conformance: discovery', () => {
  let conformance: ConformanceServer;

  beforeAll(async () => {
    conformance = await ConformanceServer.start();
  }, 60000);

  afterEach(async () => {
    await conformance.closeAll();
  });

  afterAll(async () => {
    if (conformance) await conformance.stop();
  });

  describe.each(PROTOCOL_PATHS)('over %s', (path) => {
    it('declares the extension with an empty settings object, which announces no list change', async () => {
      const client = await conformance.connect('ada', { path });

      const capabilities = await capabilitiesOf(client, path);

      expect((capabilities['extensions'] as Record<string, unknown>)[EVENTS_EXTENSION]).toEqual({});
    });

    it('lists each event with a name, a non-empty set of delivery modes and both JSON Schemas', async () => {
      const client = await conformance.connect('ada', { path });

      const listed = await conformance.rpc(client, 'events/list', {});
      const events = listed.result?.['events'] as Descriptor[];

      expect(listed.error).toBeUndefined();
      expect(listed.result?.['resultType']).toBe(path === '2026-07-28' ? 'complete' : undefined);
      expect(listed.result?.['nextCursor']).toBeUndefined();
      for (const descriptor of events) {
        expect(descriptor.name).toEqual(expect.stringMatching(/^\S+$/));
        expect(descriptor.delivery.length).toBeGreaterThan(0);
        expect(new Set(descriptor.delivery).size).toBe(descriptor.delivery.length);
        expect(descriptor.delivery.every((mode) => ['poll', 'push', 'webhook'].includes(mode))).toBe(true);
        expect(descriptor.inputSchema).toMatchObject({ type: 'object' });
        expect(descriptor.payloadSchema).toMatchObject({ type: 'object' });
        expect(descriptor._meta === undefined || typeof descriptor._meta === 'object').toBe(true);
      }
      expect(events.map(({ name, delivery }) => ({ name, delivery }))).toEqual(
        expect.arrayContaining([
          { name: 'conformance.emitted', delivery: ['poll', 'push', 'webhook'] },
          { name: 'conformance.poll-only', delivery: ['poll'] },
          { name: 'conformance.webhook-only', delivery: ['webhook'] },
        ]),
      );
    });

    it('refuses a list cursor it did not issue with InvalidParams', async () => {
      const client = await conformance.connect('ada', { path });

      const listed = await conformance.rpc(client, 'events/list', { cursor: 'not-a-cursor-it-issued' });

      expect(listed.error?.code).toBe(-32602);
    });
  });

  it('acknowledges a listen that asks for event list changes without them, since it did not declare listChanged', async () => {
    const token = await conformance.token('ada');

    const response = await conformance.post(
      'subscriptions/listen',
      { notifications: { eventsListChanged: true } },
      { token },
    );
    const reader = response.body?.getReader();
    const { value } = (await reader?.read()) ?? {};
    await reader?.cancel();
    const firstFrame = new TextDecoder().decode(value);
    const acknowledged = JSON.parse(firstFrame.slice(firstFrame.indexOf('data:') + 'data:'.length).trim());

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(acknowledged).toMatchObject({ method: 'notifications/subscriptions/acknowledged' });
    expect(acknowledged.params.notifications.eventsListChanged).toBeUndefined();
  });

  describe('a server without the extension', () => {
    let withoutEvents: ConformanceServer;

    beforeAll(async () => {
      withoutEvents = await ConformanceServer.start({ EVENTS_ENABLED: 'false' });
    }, 60000);

    afterEach(async () => {
      await withoutEvents.closeAll();
    });

    afterAll(async () => {
      if (withoutEvents) await withoutEvents.stop();
    });

    it.each(PROTOCOL_PATHS)(
      'declares no extension and answers events/* with Method not found, over %s',
      async (path) => {
        const client = await withoutEvents.connect('ada', { path });

        const capabilities = await capabilitiesOf(client, path);
        const listed = await withoutEvents.rpc(client, 'events/list', {});
        const polled = await withoutEvents.rpc(client, 'events/poll', { name: 'conformance.emitted', cursor: null });

        expect((capabilities['extensions'] as Record<string, unknown> | undefined)?.[EVENTS_EXTENSION]).toBeUndefined();
        expect(listed.error?.code).toBe(-32601);
        expect(polled.error?.code).toBe(-32601);
      },
    );
  });
});
