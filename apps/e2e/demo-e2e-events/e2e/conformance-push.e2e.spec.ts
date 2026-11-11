/**
 * Conformance of push delivery (MCP Events, SEP-3415): `events/stream` under 2026-07-28, read frame by frame from its
 * SSE body. Push over an `initialize` session is covered by `events-client.e2e.spec.ts`. See CONFORMANCE.md for rows.
 */
import { expect, type McpTestClient } from '@frontmcp/testing';

import {
  ConformanceServer,
  delay,
  ISO_TIMESTAMP,
  SUBSCRIPTION_ID_META,
  type OpenStream,
  type WireMessage,
} from './conformance.helpers';

const ACTIVE = 'notifications/events/active';
const EVENT = 'notifications/events/event';
const HEARTBEAT = 'notifications/events/heartbeat';

/** Whether a message is the given notification. */
function isNotification(method: string): (message: WireMessage) => boolean {
  return (message) => message.method === method;
}

describe('Events conformance: push', () => {
  let conformance: ConformanceServer;
  let operator: McpTestClient;
  let topicCount = 0;

  beforeAll(async () => {
    conformance = await ConformanceServer.start();
  }, 60000);

  beforeEach(async () => {
    operator = await conformance.connect('operator');
    await conformance.control(operator, 'conformance_upstream', { action: 'reset' });
  });

  afterEach(async () => {
    await conformance.closeAll();
  });

  afterAll(async () => {
    if (conformance) await conformance.stop();
  });

  /** A topic no other test publishes to. */
  function freshTopic(): string {
    topicCount += 1;
    return `push-topic-${topicCount}`;
  }

  /** Open a stream as a subject and wait for its confirmation. */
  async function openConfirmed(sub: string, params: Record<string, unknown>, id?: number) {
    const stream = await conformance.openStream(await conformance.token(sub), params, id);
    const active = await stream.waitFor(isNotification(ACTIVE));
    return { stream, active };
  }

  /** The notifications of a stream with a method, in order. */
  function notificationsOf(stream: OpenStream, method: string): WireMessage[] {
    return stream.messages.filter(isNotification(method));
  }

  it('confirms with active, then carries only its own event notifications, each tagged with the request id', async () => {
    const topic = freshTopic();
    const { stream, active } = await openConfirmed('ada', { name: 'conformance.emitted', arguments: { topic } }, 41);

    await conformance.control(operator, 'conformance_emit', { topic, count: 2 });
    await conformance.control(operator, 'conformance_emit', { topic: freshTopic() });
    await operator.tools.call('conformance_upstream', { action: 'append' });
    await waitForCount(stream, EVENT, 2);
    await delay(200);

    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.messages[0]).toBe(active);
    expect(active.params).toEqual({
      cursor: expect.any(String),
      truncated: false,
      _meta: { [SUBSCRIPTION_ID_META]: 41 },
    });
    expect(notificationsOf(stream, EVENT).map((message) => message.params)).toEqual([
      {
        eventId: expect.any(String),
        name: 'conformance.emitted',
        timestamp: expect.stringMatching(ISO_TIMESTAMP),
        data: { seq: expect.any(Number), topic },
        cursor: expect.any(String),
        _meta: { [SUBSCRIPTION_ID_META]: 41 },
      },
      expect.objectContaining({ data: { seq: expect.any(Number), topic } }),
    ]);
    for (const message of stream.messages) {
      expect(message.method).toMatch(/^notifications\/events\//);
      expect(message.params?.['_meta']).toEqual({ [SUBSCRIPTION_ID_META]: 41 });
    }
  });

  it('sends heartbeats as data frames that carry the cursor, well within 30 seconds, and no SSE comments', async () => {
    const { stream, active } = await openConfirmed('bob', {
      name: 'conformance.emitted',
      arguments: { topic: freshTopic() },
    });

    await delay(1500);

    const heartbeats = notificationsOf(stream, HEARTBEAT);
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    for (const heartbeat of heartbeats) {
      expect(heartbeat.params).toMatchObject({ cursor: active.params?.['cursor'] });
    }
    expect(stream.comments).toEqual([]);
  });

  it('reports a failing upstream with an error notification, keeps the stream open, and delivers once it recovers', async () => {
    const { stream } = await openConfirmed('carol', { name: 'conformance.replayed' });

    await conformance.control(operator, 'conformance_upstream', { action: 'fail', count: 1 });
    const failure = await stream.waitFor(isNotification('notifications/events/error'));
    await conformance.control(operator, 'conformance_upstream', { action: 'append' });
    const delivered = await stream.waitFor(isNotification(EVENT));

    expect(failure.params).toMatchObject({ error: { code: expect.any(Number), message: expect.any(String) } });
    expect(delivered.params).toMatchObject({ name: 'conformance.replayed', data: { topic: 'default' } });
    expect(stream.ended).toBe(false);
  });

  it('confirms again with truncated and a fresh cursor after a gap, and keeps delivering', async () => {
    const { stream, active } = await openConfirmed('dave', { name: 'conformance.replayed' });

    await conformance.control(operator, 'conformance_upstream', { action: 'gap' });
    await conformance.control(operator, 'conformance_upstream', { action: 'append' });
    const gap = await stream.waitFor((message) => message.method === ACTIVE && message !== active);
    await conformance.control(operator, 'conformance_upstream', { action: 'append', topic: 'after-gap' });
    const delivered = await stream.waitFor(isNotification(EVENT));

    expect(gap.params).toMatchObject({ truncated: true, cursor: expect.any(String) });
    expect(gap.params?.['cursor']).not.toBe(active.params?.['cursor']);
    expect(delivered.params).toMatchObject({ data: { topic: 'after-gap' } });
  });

  it('ends a stream whose reader lost access with terminated, then a final result, and closes it', async () => {
    const { stream } = await openConfirmed('erin', { name: 'conformance.guarded' }, 51);

    await conformance.control(operator, 'conformance_revoke', { sub: 'erin' });
    const terminated = await stream.waitFor(isNotification('notifications/events/terminated'));
    const ended = await stream.waitForEnd();
    await conformance.control(operator, 'conformance_revoke', { sub: 'erin', revoked: false });

    expect(terminated.params).toEqual({
      error: { code: -32024, message: expect.any(String), data: expect.anything() },
      _meta: { [SUBSCRIPTION_ID_META]: 51 },
    });
    expect(stream.messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 51,
      result: { resultType: 'complete', _meta: { [SUBSCRIPTION_ID_META]: 51 } },
    });
    expect(ended).toBe(true);
  });

  it('holds several streams of one reader at once and answers other requests meanwhile', async () => {
    const params = { name: 'conformance.emitted', arguments: { topic: freshTopic() } };
    const opened = await Promise.all([1, 2, 3].map(() => openConfirmed('frank', params)));

    const answered = await operator.tools.call('conformance_upstream', { action: 'append' });

    expect(opened.map(({ active }) => active.params?.['truncated'])).toEqual([false, false, false]);
    expect(answered.isError).toBe(false);
  });

  it('refuses a stream past the limit of a reader with ResourceExhausted, and frees a slot when the client cancels', async () => {
    const params = { name: 'conformance.emitted', arguments: { topic: freshTopic() } };
    const token = await conformance.token('grace');
    const opened = await Promise.all([1, 2, 3].map(() => openConfirmed('grace', params)));

    const refused = await conformance.openStream(token, params);
    const refusal = await refused.waitFor((message) => message.error !== undefined);
    await opened[0].stream.close();
    await delay(200);
    const reopened = await openConfirmed('grace', params);

    expect(refused.response.headers.get('content-type')).toContain('application/json');
    expect(refusal.error).toMatchObject({ code: -32025, data: { limit: 'subscriptions', max: 3 } });
    expect(reopened.active.params?.['truncated']).toBe(false);
  });

  it('answers a stream it cannot open with a JSON-RPC error and opens none', async () => {
    const token = await conformance.token('heidi');

    const unknown = await conformance.openStream(token, { name: 'conformance.removed' });
    const invalid = await conformance.openStream(token, { name: 'conformance.emitted', arguments: { topic: 7 } });
    const unsupported = await conformance.openStream(token, { name: 'conformance.poll-only' });

    for (const refused of [unknown, invalid, unsupported]) {
      expect(refused.response.headers.get('content-type')).toContain('application/json');
    }
    expect((await unknown.waitFor((message) => !!message.error)).error).toMatchObject({
      code: -32023,
      data: { kind: 'event' },
    });
    expect((await invalid.waitFor((message) => !!message.error)).error?.code).toBe(-32602);
    expect((await unsupported.waitFor((message) => !!message.error)).error).toMatchObject({
      code: -32026,
      data: { feature: 'deliveryMode', value: 'push' },
    });
  });

  it('confirms a stream of an event that cannot replay with a null cursor and truncated false', async () => {
    const { active } = await openConfirmed('ivan', { name: 'conformance.unreplayable' });

    expect(active.params).toMatchObject({ cursor: null, truncated: false });
  });

  it('replays from a cursor, leaving out what is older than maxAgeMs and saying truncated', async () => {
    const topic = freshTopic();
    const first = await openConfirmed('judy', { name: 'conformance.emitted', arguments: { topic } });
    await first.stream.close();
    await conformance.control(operator, 'conformance_emit', { topic });
    await delay(400);
    await conformance.control(operator, 'conformance_emit', { topic });

    const { stream, active } = await openConfirmed('judy', {
      name: 'conformance.emitted',
      arguments: { topic },
      cursor: first.active.params?.['cursor'],
      maxAgeMs: 200,
    });
    await waitForCount(stream, EVENT, 1);
    await delay(200);

    expect(active.params).toMatchObject({ truncated: true });
    expect(notificationsOf(stream, EVENT)).toHaveLength(1);
  });

  /** Wait until a stream holds `count` notifications of a method. */
  async function waitForCount(stream: OpenStream, method: string, count: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (notificationsOf(stream, method).length < count) {
      if (Date.now() > deadline) throw new Error(`${count} ${method} did not arrive`);
      await delay(20);
    }
  }
});
