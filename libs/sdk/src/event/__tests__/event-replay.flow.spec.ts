import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { EVENTS_ERROR_CODES, type SubscribeEventResult } from '@frontmcp/protocol';
import { generateStandardWebhookSecret, getRuntimeContext } from '@frontmcp/utils';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, LogLevel, type FrontMcpConfigInput } from '../../common';
import { EventForbiddenError, EventUnsupportedError } from '../../errors';
import { type Scope } from '../../scope/scope.instance';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const SECRET = generateStandardWebhookSecret();
const ada = { sessionId: 'ada-session', user: { sub: 'ada', iss: 'https://auth.example.com' } };
const asAda = { authInfo: ada, surface: 'mcp' };
const tickets: string[] = [];

const ticketUpdated = event({
  name: 'ticket.updated',
  payloadSchema: { ticketId: z.string() },
  check(_args, cursor) {
    if (cursor === null) return { events: [], cursor: String(tickets.length) };
    const position = Number(cursor);
    return {
      events: tickets.slice(position).map((ticketId) => ({ data: { ticketId } })),
      cursor: String(tickets.length),
    };
  },
});
const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });
const audits: string[] = [];
const auditAuthorize = jest.fn();
/** An event with check() whose own `authorize()` guards it. */
const auditRecorded = event({
  name: 'audit.recorded',
  payloadSchema: { auditId: z.string() },
  authorize: auditAuthorize,
  check(_args, cursor) {
    const position = cursor === null ? audits.length : Number(cursor);
    return { events: audits.slice(position).map((auditId) => ({ data: { auditId } })), cursor: String(audits.length) };
  },
});

@App({ id: 'desk', name: 'Desk', events: [ticketUpdated, orderShipped, auditRecorded] })
class DeskApp {}

interface Delivery {
  subscriptionId: string;
  json: { data: { ticketId: string }; cursor: string | null; eventId: string; name: string; type?: string };
}

describe('webhook subscriptions of an event with check()', () => {
  let scope: Scope;
  let receiver: http.Server;
  let callback: string;
  const deliveries: Delivery[] = [];

  async function startScope(extra: Partial<FrontMcpConfigInput> = {}): Promise<Scope> {
    const { instance } = await createTestFetchServer({
      info: { name: 'event-replay-flow', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'local' } as never,
      events: { webhook: { unsafeAllowLocalCallbacks: true }, poll: { nextPollMs: 40 } },
      ...extra,
    });
    const started = instance.getScopes()[0] as Scope;
    const verifier = started.events?.subscriptions?.verifier;
    if (verifier) jest.spyOn(verifier, 'verify').mockResolvedValue({ outcome: 'verified', verifiedAt: Date.now() });
    return started;
  }

  function subscribe(
    path: string,
    extra: Record<string, unknown> = {},
    name = 'ticket.updated',
  ): Promise<SubscribeEventResult> {
    const params = { name, delivery: { url: `${callback}/${path}`, secret: SECRET }, ...extra };
    return scope.runFlowForOutput('events:subscribe', {
      request: { method: 'events/subscribe', params } as never,
      ctx: asAda,
    });
  }

  async function deliveredTo(subscriptionId: string, count: number): Promise<Delivery[]> {
    const deadline = Date.now() + 4000;
    for (;;) {
      const mine = deliveries.filter((delivery) => delivery.subscriptionId === subscriptionId);
      if (mine.length >= count) return mine;
      if (Date.now() > deadline) throw new Error(`${mine.length} of ${count} deliveries arrived`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  beforeAll(async () => {
    receiver = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        deliveries.push({
          subscriptionId: String(request.headers['x-mcp-subscription-id']),
          json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    callback = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
    scope = await startScope();
  });

  afterAll(async () => {
    await scope.dispose();
    await new Promise((resolve) => receiver.close(resolve));
  });

  it('answers a new subscription with the position of the upstream, then delivers what changes after it', async () => {
    tickets.push('t-before');
    const subscribed = await subscribe('first');

    tickets.push('t-1');
    const [delivery] = await deliveredTo(subscribed.id, 1);

    expect(subscribed).toMatchObject({ cursor: '1', truncated: false });
    expect(delivery.json).toMatchObject({
      eventId: expect.stringMatching(/^evt_/),
      name: 'ticket.updated',
      data: { ticketId: 't-1' },
      cursor: '1',
    });
  });

  it('answers a refresh with the watermark: the position after what the callback acknowledged', async () => {
    const subscribed = await subscribe('watermark');
    const position = Number(subscribed.cursor);
    tickets.push('t-2');
    await deliveredTo(subscribed.id, 1);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const refreshed = await subscribe('watermark', { cursor: '0' });

    expect(refreshed.id).toBe(subscribed.id);
    expect(refreshed).toMatchObject({ cursor: String(position + 1), truncated: false });
    expect(await deliveredTo(subscribed.id, 1)).toHaveLength(1);
  });

  it('keeps what the loop delivered while a refresh verified its callback, and delivers it once', async () => {
    const subscribed = await subscribe('overlap');
    const verifier = scope.events?.subscriptions?.verifier;
    if (!verifier) throw new Error('the scope has no callback verifier');
    jest.spyOn(verifier, 'verify').mockImplementationOnce(async () => {
      tickets.push('t-overlap');
      await deliveredTo(subscribed.id, 1);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { outcome: 'verified', verifiedAt: Date.now() };
    });

    await subscribe('overlap');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const delivered = deliveries.filter((delivery) => delivery.subscriptionId === subscribed.id);
    expect(delivered.map((delivery) => delivery.json.data.ticketId)).toEqual(['t-overlap']);
    const stored = await scope.events?.subscriptions?.store.get(subscribed.id);
    expect(stored?.replay?.cursor).toBe(String(tickets.length));
  });

  it('replays from the cursor of the request for a subscription created with one', async () => {
    const before = tickets.length;
    tickets.push('t-3', 't-4');

    const subscribed = await subscribe('replay', { cursor: String(before) });
    const replayed = await deliveredTo(subscribed.id, 2);

    expect(replayed.map((delivery) => delivery.json.data.ticketId)).toEqual(['t-3', 't-4']);
    expect(replayed.every((delivery) => delivery.json.cursor === String(before))).toBe(true);
    expect(subscribed.truncated).toBe(false);
  });

  it('stops delivering once the subscription is removed', async () => {
    const subscribed = await subscribe('removed');
    await scope.runFlowForOutput('events:unsubscribe', {
      request: {
        method: 'events/unsubscribe',
        params: { name: 'ticket.updated', delivery: { url: `${callback}/removed` } },
      },
      ctx: asAda,
    });

    tickets.push('t-5');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(deliveries.filter((delivery) => delivery.subscriptionId === subscribed.id)).toEqual([]);
  });

  it('ends a subscription whose owner authorize() refuses when checked again, and reads nothing more for it', async () => {
    const subscribed = await subscribe('audits', {}, 'audit.recorded');
    const store = scope.events?.subscriptions?.store;
    await store?.update(subscribed.id, { lastAuthorizedAt: Date.now() - 3_600_000 });
    auditAuthorize.mockRejectedValue(new EventForbiddenError(EVENTS_ERROR_CODES, 'audit.recorded', 'audits closed'));

    audits.push('a-1');
    const [envelope] = await deliveredTo(subscribed.id, 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    auditAuthorize.mockReset();

    expect(envelope.json).toEqual({
      type: 'terminated',
      error: { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } },
    });
    expect(deliveries.filter((delivery) => delivery.subscriptionId === subscribed.id)).toHaveLength(1);
    await expect(store?.get(subscribed.id)).resolves.toBeUndefined();
  });

  it('keeps cursor null for an event without check()', async () => {
    await expect(subscribe('plain', {}, 'order.shipped')).resolves.toMatchObject({ cursor: null, truncated: false });
  });

  it('warns at startup that a serverless function cannot poll what it published in another call', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(getRuntimeContext).mockReturnValue({ runtime: 'node', deployment: 'serverless' } as never);
    const serverless = await startScope({ logging: { level: LogLevel.Warn } });
    jest.mocked(getRuntimeContext).mockImplementation(jest.requireActual('@frontmcp/utils').getRuntimeContext);

    const warned = warn.mock.calls.map((call) => call.map(String).join(' '));
    expect(warned).toContainEqual(expect.stringContaining('events/poll reads published events from the memory'));
    warn.mockRestore();
    await serverless.dispose();
  });

  it('keeps an event with check() off webhook where no loop can run, and says so at startup', async () => {
    jest.mocked(getRuntimeContext).mockReturnValue({ runtime: 'node', deployment: 'serverless' } as never);
    const serverless = await startScope();
    jest.mocked(getRuntimeContext).mockImplementation(jest.requireActual('@frontmcp/utils').getRuntimeContext);
    const events = serverless.events;
    const replayable = events?.findByName('ticket.updated');
    const plain = events?.findByName('order.shipped');
    const refusal = serverless.runFlowForOutput('events:subscribe', {
      request: {
        method: 'events/subscribe',
        params: { name: 'ticket.updated', delivery: { url: `${callback}/serverless`, secret: SECRET } },
      } as never,
      ctx: asAda,
    });

    expect(events?.replays).toBeUndefined();
    expect(events?.deliveryModesOf(replayable as never)).toEqual(['poll']);
    expect(events?.deliveryModesOf(plain as never)).toEqual(['poll', 'webhook']);
    await expect(refusal).rejects.toThrow(EventUnsupportedError);
    await serverless.dispose();
  });
});
