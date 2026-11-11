import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, rm } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  event,
  HttpRoute,
  HttpRouteContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../common';
import { eventsConfigSchema } from '../../common/metadata/event.metadata';
import { AuthConfigurationError, EventPublishEndpointError } from '../../errors';
import { type Scope } from '../../scope/scope.instance';
import { WorkflowWebhookReplayGuard } from '../../workflow/trigger/workflow-webhook.signature';
import { EventPublishIdempotency } from '../publish-endpoint/event-publish-idempotency';

const SECRET = 'publish-endpoint-secret-of-32-chars!';

const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string() } });

@HttpRoute({ method: 'POST', path: '/orders/:orderId', auth: 'public' })
class OrderRoute extends HttpRouteContext {
  handle() {
    return { ok: true };
  }
}

@App({ id: 'shop', name: 'Shop', events: [orderCreated], routes: [OrderRoute] })
class ShopApp {}

const logLines: string[] = [];

/** Keeps what the server logs at startup. */
@LogTransport({ name: 'PublishEndpointCapture', description: 'Captures log lines' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    logLines.push(record.message);
  }
}

const capturedLogging = { level: LogLevel.Info, enableConsole: false, transports: [CaptureLogTransport] };

/** Starts a server of the shop app with the given options. */
function startServer(extra: Partial<FrontMcpConfigInput> = {}): Promise<TestFetchServer> {
  return createTestFetchServer({
    info: { name: 'event-publish-endpoint', version: '1.0.0' },
    apps: [ShopApp],
    ...extra,
  });
}

/** The one scope of a started server. */
function scopeOf(server: TestFetchServer): Scope {
  return server.instance.getScopes()[0] as Scope;
}

describe('events.publishEndpoint configuration', () => {
  it('is off by default, on /events/publish', () => {
    expect(eventsConfigSchema.parse({}).publishEndpoint).toEqual({ enabled: false, path: '/events/publish' });
  });

  it('keeps a secret, a path and authorities as given', () => {
    const signed = eventsConfigSchema.parse({
      publishEndpoint: { enabled: true, path: '/hooks/events', secret: SECRET },
    });
    const guarded = eventsConfigSchema.parse({ publishEndpoint: { enabled: true, authorities: ['admin'] } });

    expect(signed.publishEndpoint).toEqual({ enabled: true, path: '/hooks/events', secret: SECRET });
    expect(guarded.publishEndpoint).toEqual({ enabled: true, path: '/events/publish', authorities: ['admin'] });
  });

  it.each([
    [
      'a secret under 32 characters',
      { secret: 'too-short' },
      'events.publishEndpoint.secret must be at least 32 characters',
    ],
    ['a path without a leading slash', { path: 'events/publish' }, 'events.publishEndpoint.path must start with "/"'],
    ['a path with a parameter', { path: '/events/:name' }, 'events.publishEndpoint.path must start with "/"'],
    ['a path with a query', { path: '/events?publish' }, 'events.publishEndpoint.path must start with "/"'],
    ['authorities that are no rule', { authorities: 42 }, 'events.publishEndpoint.authorities must be a profile name'],
    ['authorities of null', { authorities: null }, 'events.publishEndpoint.authorities must be a profile name'],
    [
      'a secret together with authorities',
      { secret: SECRET, authorities: 'admin' },
      'events.publishEndpoint takes secret or authorities, not both',
    ],
  ])('refuses %s', (_label, publishEndpoint, message) => {
    const parsed = eventsConfigSchema.safeParse({ publishEndpoint });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toContain(message);
  });
});

describe('enablePublishEndpoint', () => {
  const servers: TestFetchServer[] = [];

  /** Starts a server that the suite stops after the test. */
  async function started(extra: Partial<FrontMcpConfigInput>): Promise<Scope> {
    const server = await startServer(extra);
    servers.push(server);
    return scopeOf(server);
  }

  afterEach(async () => {
    for (const server of servers.splice(0)) await scopeOf(server).dispose();
  });

  it('serves no endpoint unless it is enabled', async () => {
    const scope = await started({ events: { publishEndpoint: { secret: SECRET } } });

    expect(scope.events?.publishEndpoint).toBeUndefined();
  });

  it('serves a signed endpoint on a public server, on its own storage', async () => {
    const scope = await started({ events: { publishEndpoint: { enabled: true, secret: SECRET } } });

    const endpoint = scope.events?.publishEndpoint;
    expect(endpoint).toMatchObject({ path: '/events/publish', secret: SECRET, authorities: undefined });
    expect(endpoint?.replays).toBeInstanceOf(WorkflowWebhookReplayGuard);
    expect(endpoint?.idempotency).toBeInstanceOf(EventPublishIdempotency);
    expect(scope.events?.storage).toBeUndefined();
  });

  it('keeps its records in the storage of the subscriptions when the server has one', async () => {
    const scope = await started({
      auth: { mode: 'local' } as never,
      events: { publishEndpoint: { enabled: true, secret: SECRET } },
    });
    const storage = scope.events?.storage;
    if (!storage) throw new Error('the scope keeps no event records');
    const set = jest.spyOn(storage, 'set');

    await scope.events?.publishEndpoint?.idempotency.claim('order.created', 'evt-1');

    expect(set).toHaveBeenCalledWith(expect.stringMatching(/^published:/), expect.any(String), expect.any(Object));
  });

  it('opens the configured store for its records when the server keeps no subscriptions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'events-publish-'));
    const sqlitePath = path.join(directory, 'events.sqlite');
    const config = {
      events: { store: { sqlite: { path: sqlitePath } }, publishEndpoint: { enabled: true, secret: SECRET } },
    };

    const first = await started(config);
    await first.events?.publishEndpoint?.idempotency.claim('order.created', 'evt-1');
    await first.events?.publishEndpoint?.idempotency.complete('order.created', 'evt-1', {
      eventId: 'evt-1',
      matched: 0,
    });
    const second = await started(config);

    expect(await second.events?.publishEndpoint?.idempotency.claim('order.created', 'evt-1')).toEqual({
      state: 'published',
      result: { eventId: 'evt-1', matched: 0 },
    });
    for (const server of servers.splice(0)) await scopeOf(server).dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves a bearer endpoint when the auth mode signs callers in', async () => {
    const scope = await started({
      auth: { mode: 'local' } as never,
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      events: { publishEndpoint: { enabled: true, path: '/hooks/events', authorities: 'admin' } },
    });

    expect(scope.events?.publishEndpoint).toMatchObject({
      path: '/hooks/events',
      secret: undefined,
      authorities: 'admin',
    });
  });

  it('says at startup where it listens, and warns when every signed-in caller may publish', async () => {
    logLines.length = 0;
    await started({
      auth: { mode: 'local' } as never,
      logging: capturedLogging,
      events: { publishEndpoint: { enabled: true } },
    });

    expect(logLines).toContain('Events can be published over HTTP: POST /events/publish (bearer callers)');
    expect(logLines).toContain(
      'POST /events/publish lets every signed-in caller publish every event. Set ' +
        'events.publishEndpoint.authorities to name who may publish.',
    );
  });

  it('does not warn about open publishing with a secret or with authorities', async () => {
    logLines.length = 0;
    await started({ logging: capturedLogging, events: { publishEndpoint: { enabled: true, secret: SECRET } } });
    await started({
      auth: { mode: 'local' } as never,
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      logging: capturedLogging,
      events: { publishEndpoint: { enabled: true, authorities: 'admin' } },
    });

    expect(logLines).toContain('Events can be published over HTTP: POST /events/publish (signed requests)');
    expect(logLines.filter((line) => line.includes('lets every signed-in caller publish'))).toEqual([]);
  });

  it('refuses to start on a public server without a secret', async () => {
    const start = startServer({ events: { publishEndpoint: { enabled: true } } });

    await expect(start).rejects.toThrow(EventPublishEndpointError);
    await expect(start).rejects.toThrow(
      'Event publish endpoint: the server runs in public auth mode, so nothing tells who publishes. ' +
        'Set events.publishEndpoint.secret (at least 32 characters) for signed requests, or configure an auth mode ' +
        'that signs callers in.',
    );
  });

  it('refuses authorities the server does not enforce', async () => {
    const start = startServer({
      auth: { mode: 'local' } as never,
      events: { publishEndpoint: { enabled: true, authorities: 'admin' } },
    });

    await expect(start).rejects.toThrow(AuthConfigurationError);
    await expect(start).rejects.toThrow('events.publishEndpoint');
  });

  it.each([
    ['the MCP endpoint', '/', '/'],
    ['a health probe', '/healthz', '/healthz'],
    ['an OAuth path', '/oauth/events', '/oauth'],
    ['a well-known path', '/.well-known/events', '/.well-known'],
  ])('refuses the path of %s', async (_label, endpointPath, reserved) => {
    const start = startServer({ events: { publishEndpoint: { enabled: true, secret: SECRET, path: endpointPath } } });

    await expect(start).rejects.toThrow(EventPublishEndpointError);
    await expect(start).rejects.toThrow(
      `events.publishEndpoint.path "${endpointPath}" is on the reserved FrontMCP path "${reserved}": choose another path`,
    );
  });

  it('refuses a path an @HttpRoute answers for POST', async () => {
    const start = startServer({
      events: { publishEndpoint: { enabled: true, secret: SECRET, path: '/orders/publish' } },
    });

    await expect(start).rejects.toThrow(
      'events.publishEndpoint.path "/orders/publish" is already served by the route POST /orders/:orderId',
    );
  });

  it('refuses a path an http.routes entry answers for POST', async () => {
    const start = startServer({
      http: { routes: [{ method: 'POST', path: '/hooks/events', handler: () => undefined }] } as never,
      events: { publishEndpoint: { enabled: true, secret: SECRET, path: '/hooks/events' } },
    });

    await expect(start).rejects.toThrow(
      'events.publishEndpoint.path "/hooks/events" is already served by the route POST /hooks/events',
    );
  });

  it('shares a path with a route of another method', async () => {
    const scope = await started({
      http: { routes: [{ method: 'GET', path: '/hooks/events', handler: () => undefined }] } as never,
      events: { publishEndpoint: { enabled: true, secret: SECRET, path: '/hooks/events' } },
    });

    expect(scope.events?.publishEndpoint?.path).toBe('/hooks/events');
  });
});
