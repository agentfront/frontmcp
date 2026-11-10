/**
 * Conformance of webhook subscriptions (MCP Events, SEP-3415): `events/subscribe` and `events/unsubscribe`, the
 * subscription key and id, the secret and the callback rules, TTL negotiation, and retention across a restart, over
 * both protocol paths. See CONFORMANCE.md for the rows each covers.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, WebhookReceiver } from '@frontmcp/testing';
import {
  base64Encode,
  base64urlEncode,
  generateStandardWebhookSecret,
  mkdtemp,
  randomBytes,
  rm,
} from '@frontmcp/utils';

import { ConformanceServer, ISO_TIMESTAMP, PROTOCOL_PATHS } from './conformance.helpers';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The milliseconds from now until a granted `refreshBefore`. */
function grantedMs(result: Record<string, unknown> | undefined): number {
  return Date.parse(result?.['refreshBefore'] as string) - Date.now();
}

describe('Events conformance: webhook subscriptions', () => {
  let conformance: ConformanceServer;
  let receiver: WebhookReceiver;
  const secret = generateStandardWebhookSecret();
  let topicCount = 0;

  beforeAll(async () => {
    receiver = new WebhookReceiver();
    await receiver.start();
    conformance = await ConformanceServer.start({ EVENTS_MAX_PER_PRINCIPAL: '100' });
  }, 60000);

  beforeEach(() => {
    receiver.clear();
  });

  afterEach(async () => {
    await conformance.closeAll();
  });

  afterAll(async () => {
    if (conformance) await conformance.stop();
    if (receiver) await receiver.stop();
  });

  /** The subscribe params of `conformance.emitted` for a topic no other test uses. */
  function freshSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    topicCount += 1;
    return {
      name: 'conformance.emitted',
      arguments: { topic: `webhook-topic-${topicCount}` },
      delivery: { mode: 'webhook', url: receiver.url, secret },
      cursor: null,
      ...overrides,
    };
  }

  /** The key of a subscription: its params without the secret, the cursor and the lifetime. */
  function keyOf(params: Record<string, unknown>): Record<string, unknown> {
    const { url } = params['delivery'] as { url: string };
    return { name: params['name'], arguments: params['arguments'], delivery: { mode: 'webhook', url } };
  }

  describe.each(PROTOCOL_PATHS)('over %s', (path) => {
    it('answers a subscribe with a derived id, the granted refreshBefore, a cursor and truncated', async () => {
      const client = await conformance.connect('ada', { path });

      const created = await conformance.rpc(client, 'events/subscribe', freshSubscription({ ttlMs: HOUR_MS }));
      const replayable = await conformance.rpc(
        client,
        'events/subscribe',
        freshSubscription({ name: 'conformance.replayed', ttlMs: HOUR_MS }),
      );

      expect(created.error).toBeUndefined();
      expect(created.result).toMatchObject({
        id: expect.stringMatching(/^sub_[0-9a-f]{32}$/),
        refreshBefore: expect.stringMatching(ISO_TIMESTAMP),
        cursor: null,
        truncated: false,
      });
      expect(created.result?.['resultType']).toBe(path === '2026-07-28' ? 'complete' : undefined);
      expect(grantedMs(created.result)).toBeLessThanOrEqual(HOUR_MS);
      expect(grantedMs(created.result)).toBeGreaterThan(HOUR_MS - MINUTE_MS);
      expect(replayable.result).toMatchObject({ cursor: expect.any(String), truncated: false });
    });

    it('is idempotent on its key: a repeat with a new secret is the same subscription, with a fresh lifetime', async () => {
      const client = await conformance.connect(`bob over ${path}`, { path });
      const params = freshSubscription({ ttlMs: 2 * MINUTE_MS });
      const first = await conformance.rpc(client, 'events/subscribe', params);
      const newSecret = generateStandardWebhookSecret();

      const repeated = await conformance.rpc(client, 'events/subscribe', {
        ...params,
        delivery: { mode: 'webhook', url: receiver.url, secret: newSecret },
      });

      expect(repeated.result?.['id']).toBe(first.result?.['id']);
      expect(Date.parse(repeated.result?.['refreshBefore'] as string)).toBeGreaterThanOrEqual(
        Date.parse(first.result?.['refreshBefore'] as string),
      );
      expect(receiver.verifications()).toHaveLength(1);
    });

    it('gives another subscription to another callback, other arguments, another event or another caller', async () => {
      const ada = await conformance.connect('ada', { path, tenantId: 'tenant-a' });
      const eve = await conformance.connect('eve', { path, tenantId: 'tenant-b' });
      const params = freshSubscription();
      const otherUrl = { mode: 'webhook', url: `${new URL(receiver.url).origin}/hooks/other`, secret };

      const replies = [
        await conformance.rpc(ada, 'events/subscribe', params),
        await conformance.rpc(ada, 'events/subscribe', { ...params, delivery: otherUrl }),
        await conformance.rpc(ada, 'events/subscribe', { ...params, arguments: { topic: 'another' } }),
        await conformance.rpc(ada, 'events/subscribe', { ...params, name: 'conformance.replayed', arguments: {} }),
        await conformance.rpc(eve, 'events/subscribe', params),
      ];
      const removedByEve = await conformance.rpc(eve, 'events/unsubscribe', keyOf(params));
      const refreshedByAda = await conformance.rpc(ada, 'events/subscribe', params);

      expect(new Set(replies.map((reply) => reply.result?.['id'])).size).toBe(5);
      expect(removedByEve.error).toBeUndefined();
      expect(refreshedByAda.result?.['id']).toBe(replies[0].result?.['id']);
      expect(refreshedByAda.result?.['deliveryStatus']).toEqual(expect.objectContaining({ active: true }));
    });

    it('takes no id as input: a subscribe names its subscription by its key alone', async () => {
      const ada = await conformance.connect('ada', { path });
      const eve = await conformance.connect('eve', { path });
      const theirs = await conformance.rpc(eve, 'events/subscribe', freshSubscription());
      const params = freshSubscription();

      const mine = await conformance.rpc(ada, 'events/subscribe', { ...params, id: theirs.result?.['id'] });
      const byIdOnly = await conformance.rpc(ada, 'events/unsubscribe', { id: theirs.result?.['id'] });

      expect(mine.result?.['id']).toEqual(expect.any(String));
      expect(mine.result?.['id']).not.toBe(theirs.result?.['id']);
      expect(byIdOnly.error).toEqual(expect.objectContaining({ code: expect.any(Number) }));
    });

    it('refuses a secret without whsec_, and one shorter than 24 or longer than 64 bytes', async () => {
      const client = await conformance.connect('carol', { path });
      const delivery = (value?: string) => ({ mode: 'webhook', url: receiver.url, ...(value && { secret: value }) });

      const refusals = await Promise.all(
        [
          'not-a-standard-webhooks-secret',
          `whsec_${base64Encode(randomBytes(8))}`,
          `whsec_${base64Encode(randomBytes(65))}`,
        ].map((value) => conformance.rpc(client, 'events/subscribe', freshSubscription({ delivery: delivery(value) }))),
      );
      const longest = await conformance.rpc(
        client,
        'events/subscribe',
        freshSubscription({ delivery: delivery(`whsec_${base64Encode(randomBytes(64))}`) }),
      );

      expect(refusals.map((reply) => reply.error?.code)).toEqual([-32602, -32602, -32602]);
      expect(longest.error).toBeUndefined();
    });

    it('grants the default lifetime without ttlMs, and clamps a short or a long one instead of refusing it', async () => {
      const client = await conformance.connect('dave', { path });

      const byDefault = await conformance.rpc(client, 'events/subscribe', freshSubscription());
      const short = await conformance.rpc(client, 'events/subscribe', freshSubscription({ ttlMs: 1000 }));
      const long = await conformance.rpc(client, 'events/subscribe', freshSubscription({ ttlMs: 30 * DAY_MS }));

      expect(Math.abs(grantedMs(byDefault.result) - HOUR_MS)).toBeLessThan(MINUTE_MS);
      expect(Math.abs(grantedMs(short.result) - MINUTE_MS)).toBeLessThan(10_000);
      expect(Math.abs(grantedMs(long.result) - DAY_MS)).toBeLessThan(MINUTE_MS);
    });

    it('grants a finite lifetime to a request without expiry when it keeps subscriptions in memory', async () => {
      const client = await conformance.connect('erin', { path });

      const endless = await conformance.rpc(client, 'events/subscribe', freshSubscription({ ttlMs: null }));

      expect(endless.result?.['refreshBefore']).toEqual(expect.stringMatching(ISO_TIMESTAMP));
    });

    it('unsubscribes by key with an empty result, and answers a key with no subscription the same way', async () => {
      const client = await conformance.connect('frank', { path });
      const params = freshSubscription();
      await conformance.rpc(client, 'events/subscribe', params);

      const removed = await conformance.rpc(client, 'events/unsubscribe', keyOf(params));
      const again = await conformance.rpc(client, 'events/unsubscribe', keyOf(params));

      const empty = path === '2026-07-28' ? { resultType: 'complete' } : {};
      expect(removed.result).toEqual(expect.objectContaining(empty));
      expect(Object.keys(removed.result ?? {}).filter((key) => key !== '_meta')).toEqual(Object.keys(empty));
      expect(again.result).toEqual(removed.result);
    });

    it('answers an event that is not offered by webhook with Unsupported', async () => {
      const client = await conformance.connect('grace', { path });

      const refused = await conformance.rpc(
        client,
        'events/subscribe',
        freshSubscription({ name: 'conformance.poll-only', arguments: {} }),
      );

      expect(refused.error).toMatchObject({ code: -32026, data: { feature: 'deliveryMode', value: 'webhook' } });
      expect(receiver.requests).toHaveLength(0);
    });
  });

  it('refuses a subscribe without a secret, and an unsubscribe by id alone, with InvalidParams under 2026-07-28', async () => {
    const client = await conformance.connect('heidi', { path: '2026-07-28' });
    const created = await conformance.rpc(client, 'events/subscribe', freshSubscription());

    const withoutSecret = await conformance.rpc(
      client,
      'events/subscribe',
      freshSubscription({ delivery: { mode: 'webhook', url: receiver.url } }),
    );
    const byIdOnly = await conformance.rpc(client, 'events/unsubscribe', { id: created.result?.['id'] });

    expect(withoutSecret.error?.code).toBe(-32602);
    expect(byIdOnly.error?.code).toBe(-32602);
  });

  describe('a server that keeps its callback rules', () => {
    let strict: ConformanceServer;

    beforeAll(async () => {
      strict = await ConformanceServer.start({ EVENTS_ALLOW_LOCAL_CALLBACKS: 'false' });
    }, 60000);

    afterEach(async () => {
      await strict.closeAll();
    });

    afterAll(async () => {
      if (strict) await strict.stop();
    });

    it('refuses a callback that is not https with InvalidParams, and contacts nothing', async () => {
      const client = await strict.connect('ada');

      const refused = await strict.rpc(
        client,
        'events/subscribe',
        freshSubscription({ delivery: { mode: 'webhook', url: 'http://hooks.example.com/mcp', secret } }),
      );

      expect(refused.error?.code).toBe(-32602);
    });

    it('refuses a loopback, private, link-local or local-name callback before sending it anything', async () => {
      const client = await strict.connect('ada');
      const { port } = new URL(receiver.url);
      const callbacks = [
        `https://127.0.0.1:${port}/hooks/mcp`,
        'https://10.0.0.8/hooks',
        'https://169.254.169.254/latest/meta-data',
        'https://localhost/hooks',
        'https://[::1]/hooks',
      ];

      const refusals = await Promise.all(
        callbacks.map((url) =>
          strict.rpc(client, 'events/subscribe', freshSubscription({ delivery: { mode: 'webhook', url, secret } })),
        ),
      );

      expect(refusals.map((reply) => reply.error?.code)).toEqual(callbacks.map(() => -32602));
      expect(receiver.requests).toHaveLength(0);
    });
  });

  describe('with subscriptions in a SQLite file', () => {
    let durable: ConformanceServer;
    let directory: string;

    beforeAll(async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-events-conformance-'));
      durable = await ConformanceServer.start({
        EVENTS_SQLITE_PATH: path.join(directory, 'events.sqlite'),
        MCP_EVENTS_SECRET: base64urlEncode(randomBytes(32)),
      });
    }, 60000);

    afterAll(async () => {
      if (durable) await durable.stop();
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it('keeps a long and a no-expiry subscription, and its verified callback, across a restart', async () => {
      const before = await durable.connect('ada');
      const long = freshSubscription({ ttlMs: DAY_MS });
      const endless = freshSubscription({ ttlMs: null });
      const longGrant = await durable.rpc(before, 'events/subscribe', long);
      const endlessGrant = await durable.rpc(before, 'events/subscribe', endless);
      await durable.closeAll();

      await durable.server.restart();
      const after = await durable.connect('ada');
      const longRefreshed = await durable.rpc(after, 'events/subscribe', long);
      const endlessRefreshed = await durable.rpc(after, 'events/subscribe', endless);

      expect(longGrant.error).toBeUndefined();
      expect(endlessGrant.error).toBeUndefined();
      expect(endlessGrant.result?.['refreshBefore']).toBeNull();
      expect(longRefreshed.result).toMatchObject({ id: longGrant.result?.['id'], deliveryStatus: { active: true } });
      expect(endlessRefreshed.result).toMatchObject({
        id: endlessGrant.result?.['id'],
        refreshBefore: null,
        deliveryStatus: { active: true },
      });
      expect(receiver.verifications()).toHaveLength(1);
    }, 60000);
  });
});
