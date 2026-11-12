import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, LogLevel, Plugin, type FlowCtxOf, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { EventPublishHook, EventPublishHttpHook } from '../../index';
import { type Scope } from '../../scope/scope.instance';
import { signWorkflowWebhook } from '../../workflow/trigger/workflow-webhook.signature';
import { EVENT_PUBLISH_MAX_BODY_BYTES } from '../flows/event-publish-http.flow';
import { type EventPublishEndpoint } from '../publish-endpoint/event-publish-endpoint';

const SECRET = 'publish-endpoint-secret-of-32-chars!';
const encoder = new TextEncoder();

const orderCreated = event({
  name: 'order.created',
  payloadSchema: { orderId: z.string(), total: z.number() },
});
const auditLogged = event({ name: 'audit.logged', payloadSchema: { action: z.string() } });

@App({ id: 'shop', name: 'Shop', events: [orderCreated, auditLogged] })
class ShopApp {}

const published = jest.fn();
const authenticated = jest.fn();
const finished = jest.fn();

/** Records what reaches `events:publish`, who the endpoint authenticated, and the failure each request ended with. */
@Plugin({ name: 'publish-audit' })
class PublishAuditPlugin {
  @EventPublishHook.Did('validate')
  recordPublish(ctx: FlowCtxOf<'events:publish'>) {
    published(ctx.rawInput);
  }

  @EventPublishHttpHook.Did('authenticate')
  recordCaller(ctx: FlowCtxOf<'events:publish-http'>) {
    authenticated(ctx.state.caller?.user?.sub);
  }

  @EventPublishHttpHook.Finally('finalize')
  recordFailure(ctx: FlowCtxOf<'events:publish-http'>) {
    finished(ctx.error);
  }
}

interface Answer {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

let signedSecondsAgo = 0;

/** A publish request signed with the endpoint's secret; each one gets a timestamp of its own, so none is a replay. */
function signedRequest(
  body: unknown,
  options: { secret?: string; timestamp?: string; path?: string; headers?: Record<string, string> } = {},
): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000) - signedSecondsAgo++);
  return new Request(`http://localhost${options.path ?? '/events/publish'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-frontmcp-timestamp': timestamp,
      'x-frontmcp-signature': signWorkflowWebhook(options.secret ?? SECRET, timestamp, encoder.encode(text)),
      ...options.headers,
    },
    body: text,
  });
}

/** A publish request with a bearer token, or with none. */
function bearerRequest(body: unknown, token?: string): Request {
  return new Request('http://localhost/events/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

/** Sends a request to the server's fetch handler and reads its answer. */
async function send(server: TestFetchServer, request: Request): Promise<Answer> {
  const response = await server.handler(request);
  const text = await response.text();
  const isJson = response.headers.get('content-type')?.includes('application/json') === true;
  return { status: response.status, headers: response.headers, body: isJson ? JSON.parse(text) : { text } };
}

/** Starts a server whose endpoint takes signed requests, unless `extra` says otherwise. */
function startServer(extra: Partial<FrontMcpConfigInput> = {}): Promise<TestFetchServer> {
  return createTestFetchServer({
    info: { name: 'event-publish-http', version: '1.0.0' },
    apps: [ShopApp],
    plugins: [PublishAuditPlugin],
    events: { publishEndpoint: { enabled: true, secret: SECRET } },
    ...extra,
  });
}

/** Stops a started server. */
function stop(server: TestFetchServer): Promise<void> {
  return (server.instance.getScopes()[0] as Scope).dispose();
}

/** The publish endpoint the server's scope serves. */
function endpointOf(server: TestFetchServer): EventPublishEndpoint {
  const endpoint = (server.instance.getScopes()[0] as Scope).events?.publishEndpoint;
  if (!endpoint) throw new Error('the scope serves no publish endpoint');
  return endpoint;
}

const order = { name: 'order.created', data: { orderId: 'o-1', total: 42 } };

describe('events:publish-http with a secret', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await stop(server);
  });

  it('publishes a signed request through events:publish and answers 202', async () => {
    const answer = await send(server, signedRequest(order));

    expect(answer.status).toBe(202);
    expect(answer.body).toEqual({ eventId: expect.stringMatching(/^evt_/), matched: 0 });
    expect(published).toHaveBeenCalledTimes(1);
    expect(published.mock.calls[0][0].occurrence).toMatchObject({
      eventId: answer.body['eventId'],
      name: 'order.created',
      data: { orderId: 'o-1', total: 42 },
    });
  });

  it('passes the id, the time, the audience and the subscription on to the publisher', async () => {
    const audience = { sub: ['ada', 'bob'], tenantId: 'acme', roles: { any: ['admin'], all: ['staff'] } };
    const request = {
      ...order,
      eventId: 'upstream-1',
      timestamp: '2026-10-02T12:00:00+02:00',
      audience,
      subscriptionId: 'sub_0001',
    };

    const answer = await send(server, signedRequest(request));

    expect(answer.body).toEqual({ eventId: 'upstream-1', matched: 0 });
    expect(published.mock.calls[0][0]).toMatchObject({
      occurrence: { eventId: 'upstream-1', timestamp: '2026-10-02T10:00:00.000Z' },
      audience,
      subscriptionId: 'sub_0001',
    });
  });

  it('is served with a trailing slash and a charset on the content type', async () => {
    const request = signedRequest(order, {
      path: '/events/publish/',
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

    expect((await send(server, request)).status).toBe(202);
  });

  it('leaves other methods and other paths to the rest of the server', async () => {
    const get = await server.handler(new Request('http://localhost/events/publish'));
    const elsewhere = await send(server, signedRequest(order, { path: '/events/other' }));

    expect(get.status).toBe(404);
    expect(elsewhere.status).toBe(404);
    expect(published).not.toHaveBeenCalled();
  });

  describe('refuses', () => {
    it.each([
      ['an unsigned request', { 'x-frontmcp-signature': '' }],
      ['a signature that is not v1=<hex>', { 'x-frontmcp-signature': 'v1=nope' }],
      ['a signature of another secret', { 'x-frontmcp-signature': `v1=${'0'.repeat(64)}` }],
    ])('%s with 401', async (_label, headers) => {
      const request = signedRequest(order, { headers });
      if (headers['x-frontmcp-signature'] === '') request.headers.delete('x-frontmcp-signature');

      const answer = await send(server, request);

      expect(answer.status).toBe(401);
      expect(answer.body).toEqual({ error: 'Unauthorized' });
      expect(published).not.toHaveBeenCalled();
    });

    it('a request signed with another secret', async () => {
      const answer = await send(server, signedRequest(order, { secret: 'another-secret-that-is-32-chars-long' }));

      expect(answer.status).toBe(401);
    });

    it('a request signed more than five minutes ago', async () => {
      const longAgo = String(Math.floor(Date.now() / 1000) - 301);

      expect((await send(server, signedRequest(order, { timestamp: longAgo }))).status).toBe(401);
    });

    it('the same signed request sent twice', async () => {
      const timestamp = String(Math.floor(Date.now() / 1000) + 5);

      const first = await send(server, signedRequest(order, { timestamp }));
      const second = await send(server, signedRequest(order, { timestamp }));

      expect(first.status).toBe(202);
      expect(second.status).toBe(401);
      expect(published).toHaveBeenCalledTimes(1);
    });

    it('a body that is not JSON with 415', async () => {
      const answer = await send(server, signedRequest(order, { headers: { 'content-type': 'text/plain' } }));

      expect(answer.status).toBe(415);
      expect(answer.body).toEqual({ error: 'The body must be application/json' });
    });

    it('a request without a content type with 415', async () => {
      const request = signedRequest(order);
      request.headers.delete('content-type');

      expect((await send(server, request)).status).toBe(415);
    });

    it('a body over 256 KiB with 413, before its signature is checked', async () => {
      const blob = 'x'.repeat(EVENT_PUBLISH_MAX_BODY_BYTES);
      const unsigned = signedRequest({ ...order, data: { orderId: blob, total: 1 } }, { secret: 'wrong'.repeat(8) });

      const answer = await send(server, unsigned);

      expect(answer.status).toBe(413);
      expect(answer.body).toEqual({ error: 'Payload too large' });
    });

    it.each([
      ['text that is not JSON', 'not json', [{ path: '', message: expect.any(String) }]],
      ['a JSON array', '[1]', [{ path: '', message: expect.any(String) }]],
      ['a body without data', { name: 'order.created' }, [{ path: 'data', message: expect.any(String) }]],
      ['an empty name', { name: '', data: {} }, [{ path: 'name', message: expect.any(String) }]],
      ['a key it does not know', { ...order, audiance: { sub: 'ada' } }, [{ path: '', message: expect.any(String) }]],
      [
        'an audience key it does not know',
        { ...order, audience: { subject: 'ada' } },
        [{ path: 'audience', message: expect.any(String) }],
      ],
      [
        'an eventId with a space',
        { ...order, eventId: 'two words' },
        [{ path: 'eventId', message: 'eventId must be 1 to 255 visible ASCII characters' }],
      ],
      [
        'a timestamp that is not a date',
        { ...order, timestamp: 'yesterday' },
        [{ path: 'timestamp', message: 'timestamp must be a date such as 2026-10-02T12:00:00Z' }],
      ],
    ])('%s with 400', async (_label, body, issues) => {
      const answer = await send(server, signedRequest(body));

      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ error: 'Invalid publish request', issues });
      expect(published).not.toHaveBeenCalled();
    });

    it('an event the server does not have with 404', async () => {
      const answer = await send(server, signedRequest({ name: 'order.cancelled', data: {} }));

      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({ error: 'Event "order.cancelled" is not registered' });
    });

    it('data that does not match the payload schema with 422, without repeating the data', async () => {
      const request = { name: 'order.created', data: { orderId: 'o-secret-7', total: 'a-lot' } };

      const answer = await send(server, signedRequest(request));

      expect(answer.status).toBe(422);
      expect(answer.body).toEqual({
        error: 'data does not match the payloadSchema of event "order.created"',
        issues: [{ path: 'total', message: expect.any(String) }],
      });
      expect(JSON.stringify(answer.body)).not.toContain('o-secret-7');
      expect(JSON.stringify(answer.body)).not.toContain('a-lot');
      expect(published).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['a bad signature', () => signedRequest(order, { secret: 'another-secret-that-is-32-chars-long' }), 401],
    ['a stale timestamp', () => signedRequest(order, { timestamp: '1700000000' }), 401],
    ['an invalid body', () => signedRequest({ name: 'order.created' }), 400],
    ['an unknown event', () => signedRequest({ name: 'order.cancelled', data: {} }), 404],
  ])('keeps a refusal for %s as the failure of the run, with its status', async (_label, request, status) => {
    const answer = await send(server, request());

    expect(answer.status).toBe(status);
    expect(finished).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EVENT_PUBLISH_REFUSED',
        statusCode: status,
        message: `HTTP ${status}: ${answer.body['error']}`,
      }),
    );
  });

  it('ends a published request, and a repeated eventId, without a failure', async () => {
    const request = { ...order, eventId: 'no-failure-1' };

    await send(server, signedRequest(request));
    await send(server, signedRequest(request));

    expect(finished.mock.calls).toEqual([[undefined], [undefined]]);
  });

  it('answers 500 when the payload schema fails for another reason than the data', async () => {
    const scope = server.instance.getScopes()[0] as Scope;
    const entry = scope.events?.findByName('order.created');
    if (!entry) throw new Error('order.created is not registered');
    jest.spyOn(entry, 'parsePayload').mockImplementationOnce(() => {
      throw new Error('the schema is broken');
    });

    const answer = await send(server, signedRequest(order));

    expect(answer.status).toBe(500);
    expect(published).not.toHaveBeenCalled();
  });

  describe('a repeated eventId', () => {
    it('answers what the first request got and does not publish again', async () => {
      const request = { ...order, eventId: 'repeat-1' };

      const first = await send(server, signedRequest(request));
      const second = await send(server, signedRequest({ ...request, data: { orderId: 'o-2', total: 7 } }));

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body).toEqual(first.body);
      expect(published).toHaveBeenCalledTimes(1);
    });

    it('is published again for another event', async () => {
      await send(server, signedRequest({ ...order, eventId: 'repeat-2' }));
      const other = await send(
        server,
        signedRequest({ name: 'audit.logged', data: { action: 'login' }, eventId: 'repeat-2' }),
      );

      expect(other.status).toBe(202);
      expect(published).toHaveBeenCalledTimes(2);
    });

    it('is answered 409 while its first request is still publishing', async () => {
      await endpointOf(server).idempotency.claim('order.created', 'repeat-3');

      const answer = await send(server, signedRequest({ ...order, eventId: 'repeat-3' }));

      expect(answer.status).toBe(409);
      expect(answer.body).toEqual({
        error: 'Event "order.created" with eventId "repeat-3" is being published; retry for its answer',
      });
      expect(published).not.toHaveBeenCalled();
    });

    it('can be published by a retry after the first request failed', async () => {
      const scope = server.instance.getScopes()[0] as Scope;
      const publisher = scope.events?.publisher as { publish: (...args: unknown[]) => Promise<unknown> };
      jest.spyOn(publisher, 'publish').mockRejectedValueOnce(new Error('the store is down'));
      const request = { ...order, eventId: 'repeat-4' };

      const failed = await send(server, signedRequest(request));
      const retried = await send(server, signedRequest(request));

      expect(failed.status).toBe(500);
      expect(retried.status).toBe(202);
      expect(retried.body).toEqual({ eventId: 'repeat-4', matched: 0 });
    });

    it('answers 202 for a published event whose answer the store could not keep', async () => {
      jest.spyOn(endpointOf(server).idempotency, 'complete').mockRejectedValueOnce(new Error('the store is down'));

      const answer = await send(server, signedRequest({ ...order, eventId: 'repeat-5' }));

      expect(answer.status).toBe(202);
      expect(answer.body).toEqual({ eventId: 'repeat-5', matched: 0 });
      expect(published).toHaveBeenCalledTimes(1);
    });

    it('does not keep an answer for a request without an eventId', async () => {
      const failing = jest.spyOn(endpointOf(server).idempotency, 'release');
      const scope = server.instance.getScopes()[0] as Scope;
      const publisher = scope.events?.publisher as { publish: (...args: unknown[]) => Promise<unknown> };
      jest.spyOn(publisher, 'publish').mockRejectedValueOnce(new Error('the store is down'));

      const answer = await send(server, signedRequest(order));

      expect(answer.status).toBe(500);
      expect(failing).not.toHaveBeenCalled();
    });
  });
});

describe('events:publish-http on a splitByApp server', () => {
  const invoiceSent = event({ name: 'invoice.sent', payloadSchema: { invoiceId: z.string() } });
  const ticketOpened = event({ name: 'ticket.opened', payloadSchema: { ticketId: z.string() } });

  @App({ id: 'billing', name: 'Billing', events: [invoiceSent] })
  class BillingApp {}

  @App({ id: 'support', name: 'Support', events: [ticketOpened] })
  class SupportApp {}

  it('serves the endpoint of each app under its route base, for the events of that app', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-publish', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      splitByApp: true,
      logging: { level: LogLevel.Off },
      events: { publishEndpoint: { enabled: true, secret: SECRET } },
    });
    const invoice = { name: 'invoice.sent', data: { invoiceId: 'i-1' } };
    const publishAt = (path: string) => handler(signedRequest(invoice, { path }));

    expect((await publishAt('/billing/events/publish')).status).toBe(202);
    expect((await publishAt('/support/events/publish')).status).toBe(404);
    expect((await publishAt('/events/publish')).status).toBe(404);
  });
});

describe('events:publish-http guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses a peer throttle.ipFilter denies before it reads the request', async () => {
    const server = await startServer({ throttle: { enabled: true, ipFilter: { denyList: ['203.0.113.0/24'] } } });
    const scope = server.instance.getScopes()[0] as Scope;
    const request = {
      method: 'POST',
      path: '/events/publish',
      url: '/events/publish',
      headers: {},
      query: {},
      socket: { remoteAddress: '::ffff:203.0.113.9' },
    };

    const answer = await scope.runFlow('events:publish-http', { request, response: {} } as never);

    expect(answer).toMatchObject({ status: 403 });
    expect(published).not.toHaveBeenCalled();
    await scope.dispose();
  });

  it('counts requests against the global rate limit', async () => {
    const server = await startServer({
      throttle: { enabled: true, global: { maxRequests: 1, windowMs: 60_000, partitionBy: 'global' } },
    });

    const first = await send(server, signedRequest(order));
    const second = await send(server, signedRequest(order));

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(published).toHaveBeenCalledTimes(1);
    await stop(server);
  });
});

describe('events:publish-http with bearer credentials', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;

  /** Starts a server whose endpoint takes the bearer tokens of the test issuer. */
  function bearerServer(extra: Partial<FrontMcpConfigInput> = {}, allowAnonymous = false): Promise<TestFetchServer> {
    return startServer({
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        allowAnonymous,
      } as never,
      authorities: { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } },
      events: { publishEndpoint: { enabled: true } },
      ...extra,
    });
  }

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await bearerServer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await stop(server);
  });

  it('publishes for a caller with a verified token', async () => {
    const token = await issuer.sign({}, 'ada');

    const answer = await send(server, bearerRequest(order, token));

    expect(answer.status).toBe(202);
    expect(answer.body).toEqual({ eventId: expect.stringMatching(/^evt_/), matched: 0 });
    expect(authenticated).toHaveBeenCalledWith('ada');
    expect(published).toHaveBeenCalledTimes(1);
  });

  it('refuses a request without a token with 401 and a challenge', async () => {
    const answer = await send(server, bearerRequest(order));

    expect(answer.status).toBe(401);
    expect(answer.body).toEqual({ error: 'Unauthorized' });
    expect(answer.headers.get('www-authenticate')).toContain('Bearer');
    expect(published).not.toHaveBeenCalled();
  });

  it('refuses a token it cannot verify with 401', async () => {
    const stranger = await createTestJwtIssuer(issuer.issuer);

    const answer = await send(server, bearerRequest(order, await stranger.sign({}, 'mallory')));

    expect(answer.status).toBe(401);
    expect(published).not.toHaveBeenCalled();
  });

  it('refuses a token without the scopes the server requires with 403 and a challenge', async () => {
    const scoped = await bearerServer({
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        requiredScopes: ['events:publish'],
      } as never,
    });

    const refused = await send(scoped, bearerRequest(order, await issuer.sign({ scope: 'orders:read' }, 'ada')));
    const allowed = await send(scoped, bearerRequest(order, await issuer.sign({ scope: 'events:publish' }, 'ada')));

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'Forbidden' });
    expect(refused.headers.get('www-authenticate')).toContain('insufficient_scope');
    expect(allowed.status).toBe(202);
    await stop(scoped);
  });

  it('refuses a request the session check gives no answer for with 401', async () => {
    const scope = server.instance.getScopes()[0] as Scope;
    const runFlow = scope.runFlow.bind(scope) as (name: string, input: unknown) => Promise<unknown>;
    jest
      .spyOn(scope, 'runFlow')
      .mockImplementation(((name: string, input: unknown) =>
        name === 'session:verify' ? Promise.resolve(undefined) : runFlow(name, input)) as never);

    const answer = await send(server, bearerRequest(order, await issuer.sign({}, 'ada')));

    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toBeNull();
  });

  it('refuses an anonymous caller on a server that lets anonymous callers in', async () => {
    const open = await bearerServer({}, true);

    const answer = await send(open, bearerRequest(order));

    expect(answer.status).toBe(401);
    expect(answer.body).toEqual({ error: 'Unauthorized', message: 'Publishing needs a signed-in caller' });
    expect(published).not.toHaveBeenCalled();
    await stop(open);
  });

  describe('with authorities', () => {
    let guarded: TestFetchServer;

    beforeAll(async () => {
      guarded = await bearerServer({
        events: { publishEndpoint: { enabled: true, authorities: 'admin' } },
      });
    });

    afterAll(async () => {
      await stop(guarded);
    });

    it('publishes for a caller the rule allows', async () => {
      const token = await issuer.sign({ roles: ['admin'] }, 'ada');

      expect((await send(guarded, bearerRequest(order, token))).status).toBe(202);
    });

    it('refuses a caller the rule does not allow with 403', async () => {
      const token = await issuer.sign({ roles: ['member'] }, 'bob');

      const answer = await send(guarded, bearerRequest(order, token));

      expect(answer.status).toBe(403);
      expect(answer.body).toEqual({ error: 'Forbidden' });
      expect(published).not.toHaveBeenCalled();
    });

    it('evaluates the rule with the request body as its input', async () => {
      const byEvent = await bearerServer({
        events: {
          publishEndpoint: {
            enabled: true,
            authorities: {
              attributes: { conditions: [{ path: 'input.name', op: 'eq', value: { fromClaims: 'publishes' } }] },
            },
          },
        },
      });
      const token = await issuer.sign({ publishes: 'audit.logged' }, 'audit-service');

      const allowed = await send(byEvent, bearerRequest({ name: 'audit.logged', data: { action: 'login' } }, token));
      const refused = await send(byEvent, bearerRequest(order, token));

      expect(allowed.status).toBe(202);
      expect(refused.status).toBe(403);
      await stop(byEvent);
    });
  });
});
