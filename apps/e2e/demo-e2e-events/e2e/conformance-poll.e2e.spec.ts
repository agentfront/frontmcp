/**
 * Conformance of poll delivery (MCP Events, SEP-3415): `events/poll`, its cursor lifecycle, `maxEvents`, `maxAgeMs`,
 * `truncated`, the `EventOccurrence` shape and its refusals, over both protocol paths. See CONFORMANCE.md for the rows.
 */
import { expect, type McpTestClient } from '@frontmcp/testing';

import { ConformanceServer, delay, ISO_TIMESTAMP, PROTOCOL_PATHS, type RpcReply } from './conformance.helpers';

interface PollResult {
  events: Array<Record<string, unknown>>;
  cursor: string | null;
  truncated: boolean;
  hasMore: boolean;
  nextPollMs: number;
  resultType?: string;
}

describe('Events conformance: poll', () => {
  let conformance: ConformanceServer;
  let topicCount = 0;

  beforeAll(async () => {
    conformance = await ConformanceServer.start();
  }, 60000);

  afterEach(async () => {
    await conformance.closeAll();
  });

  afterAll(async () => {
    if (conformance) await conformance.stop();
  });

  /** A topic no other test publishes to. */
  function freshTopic(): string {
    topicCount += 1;
    return `poll-topic-${topicCount}`;
  }

  /** Publish `count` occurrences of `conformance.emitted` for a topic. */
  async function emit(client: McpTestClient, topic: string, count = 1, eventId?: string): Promise<void> {
    await conformance.control(client, 'conformance_emit', { topic, count, ...(eventId && { eventId }) });
  }

  /** Poll `conformance.emitted` for a topic, failing on an error. */
  async function poll(client: McpTestClient, topic: string, params: Record<string, unknown>): Promise<PollResult> {
    const reply: RpcReply = await conformance.rpc(client, 'events/poll', {
      name: 'conformance.emitted',
      arguments: { topic },
      ...params,
    });
    if (reply.error) throw new Error(`events/poll failed: ${reply.error.message}`);
    return reply.result as unknown as PollResult;
  }

  describe.each(PROTOCOL_PATHS)('over %s', (path) => {
    it('bootstraps the subscription with a first poll on a null cursor: no events and the position to resume from', async () => {
      const client = await conformance.connect('ada', { path });
      const topic = freshTopic();
      await emit(client, topic, 2);

      const first = await poll(client, topic, { cursor: null });

      expect(first).toMatchObject({
        events: [],
        cursor: expect.any(String),
        truncated: false,
        hasMore: false,
        nextPollMs: 200,
      });
      expect(first.resultType).toBe(path === '2026-07-28' ? 'complete' : undefined);
    });

    it('treats an absent cursor as a null one: both start from now, at the same position', async () => {
      const client = await conformance.connect('ada', { path });
      const topic = freshTopic();
      await emit(client, topic, 2);

      const absent = await poll(client, topic, {});
      const explicit = await poll(client, topic, { cursor: null });

      expect(absent.events).toEqual([]);
      expect(explicit.events).toEqual([]);
      expect(absent.cursor).toBe(explicit.cursor);
    });

    it('moves the cursor of a quiet subscription forward, and keeps answering one', async () => {
      const client = await conformance.connect('bob', { path });
      const topic = freshTopic();
      const start = await poll(client, topic, { cursor: null });

      await emit(client, freshTopic(), 2);
      const quiet = await poll(client, topic, { cursor: start.cursor });

      expect(quiet.events).toEqual([]);
      expect(quiet.cursor).toEqual(expect.any(String));
      expect(quiet.cursor).not.toBe(start.cursor);
    });

    it('answers each poll by itself: another connection that holds the cursor reads the same', async () => {
      const first = await conformance.connect('carol', { path });
      const second = await conformance.connect('carol', { path });
      const topic = freshTopic();
      const start = await poll(first, topic, { cursor: null });
      await emit(first, topic);

      const fromFirst = await poll(first, topic, { cursor: start.cursor });
      const fromSecond = await poll(second, topic, { cursor: start.cursor });

      expect(fromFirst.events).toHaveLength(1);
      expect(fromSecond).toEqual(fromFirst);
    });

    it('delivers each occurrence with its upstream id, its name, an ISO timestamp and its data, and no cursor of its own', async () => {
      const client = await conformance.connect('dave', { path });
      const topic = freshTopic();
      const start = await poll(client, topic, { cursor: null });
      await emit(client, topic, 1, `upstream-${topic}`);
      await emit(client, topic);

      const next = await poll(client, topic, { cursor: start.cursor });

      expect(next.events).toEqual([
        {
          eventId: `upstream-${topic}`,
          name: 'conformance.emitted',
          timestamp: expect.stringMatching(ISO_TIMESTAMP),
          data: { seq: expect.any(Number), topic },
        },
        {
          eventId: expect.stringMatching(/^evt_/),
          name: 'conformance.emitted',
          timestamp: expect.stringMatching(ISO_TIMESTAMP),
          data: { seq: expect.any(Number), topic },
        },
      ]);
    });

    it('caps a batch at maxEvents and says hasMore while more wait', async () => {
      const client = await conformance.connect('erin', { path });
      const topic = freshTopic();
      const start = await poll(client, topic, { cursor: null });
      await emit(client, topic, 3);

      const first = await poll(client, topic, { cursor: start.cursor, maxEvents: 2 });
      const rest = await poll(client, topic, { cursor: first.cursor, maxEvents: 2 });

      expect(first).toMatchObject({ hasMore: true, nextPollMs: expect.any(Number) });
      expect(first.events).toHaveLength(2);
      expect(rest).toMatchObject({ hasMore: false });
      expect(rest.events).toHaveLength(1);
    });

    it('skips what is older than maxAgeMs after a cursor and says truncated, and ignores maxAgeMs on a null cursor', async () => {
      const client = await conformance.connect('frank', { path });
      const topic = freshTopic();
      const start = await poll(client, topic, { cursor: null });
      await emit(client, topic);
      await delay(400);
      await emit(client, topic);

      const floored = await poll(client, topic, { cursor: start.cursor, maxAgeMs: 200 });
      const fromNow = await poll(client, topic, { cursor: null, maxAgeMs: 200 });

      expect(floored).toMatchObject({ truncated: true, cursor: expect.any(String) });
      expect(floored.events).toHaveLength(1);
      expect(fromNow).toMatchObject({ events: [], truncated: false });
    });

    it('answers a cursor older than what it keeps with truncated and a fresh cursor, never with an error', async () => {
      const client = await conformance.connect('grace', { path });
      const topic = freshTopic();
      const start = await poll(client, topic, { cursor: null });
      await emit(client, topic, 60);

      const behind = await poll(client, topic, { cursor: start.cursor });

      expect(behind).toMatchObject({ truncated: true, cursor: expect.any(String) });
      expect(behind.cursor).not.toBe(start.cursor);
      expect(behind.events.length).toBeLessThan(60);
    });

    it('answers truncated false and a null cursor, every time, for an event that cannot replay', async () => {
      const client = await conformance.connect('heidi', { path });
      const params = { name: 'conformance.unreplayable', cursor: null, maxAgeMs: 1000 };

      const first = await conformance.rpc(client, 'events/poll', params);
      const second = await conformance.rpc(client, 'events/poll', params);

      expect(first.result).toMatchObject({ events: [], cursor: null, truncated: false });
      expect(second.result).toMatchObject({ events: [], cursor: null, truncated: false });
    });

    it('refuses with a JSON-RPC error: an unknown event, arguments the schema refuses, a mode not offered', async () => {
      const client = await conformance.connect('ivan', { path });

      const unknown = await conformance.rpc(client, 'events/poll', { name: 'conformance.removed', cursor: null });
      const invalid = await conformance.rpc(client, 'events/poll', {
        name: 'conformance.emitted',
        arguments: { topic: 12345 },
        cursor: null,
      });
      const unsupported = await conformance.rpc(client, 'events/poll', {
        name: 'conformance.webhook-only',
        cursor: null,
      });

      expect(unknown.error).toMatchObject({ code: -32023, data: { kind: 'event' } });
      expect(invalid.error?.code).toBe(-32602);
      expect(unsupported.error).toMatchObject({ code: -32026, data: { feature: 'deliveryMode', value: 'poll' } });
    });
  });

  it('refuses a poll that names no event with InvalidParams under 2026-07-28', async () => {
    const client = await conformance.connect('judy', { path: '2026-07-28' });

    const unnamed = await conformance.rpc(client, 'events/poll', { arguments: {}, cursor: null });

    expect(unnamed.error?.code).toBe(-32602);
  });

  it('answers a client detected as OpenAI with the codes of the design sketch', async () => {
    const client = await conformance.connect('judy', { platform: 'openai' });

    const unknown = await conformance.rpc(client, 'events/poll', { name: 'conformance.removed', cursor: null });
    const unsupported = await conformance.rpc(client, 'events/poll', {
      name: 'conformance.webhook-only',
      cursor: null,
    });

    expect(unknown.error?.code).toBe(-32011);
    expect(unsupported.error?.code).toBe(-32014);
  });
});
