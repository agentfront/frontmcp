/** `@HttpRoute` metadata and the routes of a server are checked when the class is declared and when the server boots. */
import 'reflect-metadata';

import { App, HttpRoute, LogLevel, type FrontMcpConfigInput, type HttpRouteMetadata } from '../../common';
import { HttpRouteContext } from '../../common/interfaces/http-route.interface';
import { InvalidDecoratorMetadataError, InvalidHttpRouteError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { ReservedRouteCollisionError } from '../../server/custom-routes.helper';

function routeClass(metadata: HttpRouteMetadata) {
  @HttpRoute(metadata)
  class Route extends HttpRouteContext {
    handle() {
      return 'ok';
    }
  }
  return Route;
}

function boot(routes: unknown[], config: Partial<FrontMcpConfigInput> = {}): Promise<FrontMcpInstance> {
  @App({ id: 'web', name: 'web', routes: routes as never })
  class WebApp {}
  return FrontMcpInstance.createForGraph({
    info: { name: 'routes', version: '1.0.0' },
    apps: [WebApp],
    logging: { level: LogLevel.Off },
    ...config,
  });
}

describe('@HttpRoute', () => {
  it.each([
    ['an unknown method', { method: 'TRACE', path: '/x' }, 'method'],
    ['a relative path', { method: 'GET', path: 'x' }, 'path'],
    ['a path with a query', { method: 'GET', path: '/x?y=1' }, 'path'],
    ['an unknown auth', { method: 'GET', path: '/x', auth: 'mcp' }, 'auth'],
    [
      'an SSE route on POST',
      { method: 'POST', path: '/x', sse: { store: { subscribe: () => () => undefined }, topics: ['t'] } },
      'sse',
    ],
    [
      'an SSE route with no topic',
      { method: 'GET', path: '/x', sse: { store: { subscribe: () => () => undefined }, topics: [] } },
      'sse.topics',
    ],
    [
      'an SSE route without a topic store',
      { method: 'GET', path: '/x', sse: { store: {}, topics: ['t'] } },
      'sse.store',
    ],
  ])('refuses %s', (_case, metadata, field) => {
    expect(() => routeClass(metadata as HttpRouteMetadata)).toThrow(
      expect.objectContaining({ constructor: InvalidDecoratorMetadataError, message: expect.stringContaining(field) }),
    );
  });

  it('refuses a class without handle()', () => {
    expect(() => HttpRoute({ method: 'GET', path: '/x' })(class NoHandle {} as never)).toThrow(
      InvalidDecoratorMetadataError,
    );
  });

  it('refuses an app route that is not an @HttpRoute class', () => {
    expect(() => {
      @App({ name: 'bad', routes: [class Plain {}] as never })
      class BadApp {}
      return BadApp;
    }).toThrow();
  });
});

describe('the routes of a server', () => {
  it('refuse a people route when http.auth.people is not set', async () => {
    await expect(boot([routeClass({ method: 'GET', path: '/x', auth: 'people' })])).rejects.toThrow(
      InvalidHttpRouteError,
    );
  });

  it('are public by default when http.auth.people is not set', async () => {
    const instance = await boot([routeClass({ method: 'GET', path: '/x' })]);

    expect(instance.getScopes()[0].httpRouteTable?.routes.map((route) => route.auth)).toEqual(['public']);
  });

  it('need a signed-in person by default when http.auth.people is set', async () => {
    const instance = await boot([routeClass({ method: 'GET', path: '/x' })], {
      http: { auth: { people: 'loopback-token' } },
    });
    const routes = instance.getScopes()[0].httpRouteTable?.routes ?? [];

    expect(routes.find((route) => route.path === '/x')?.auth).toBe('people');
  });

  it('refuse two routes on one method and path', async () => {
    await expect(
      boot([routeClass({ method: 'GET', path: '/x' }), routeClass({ method: 'GET', path: '/x/' })]),
    ).rejects.toThrow(InvalidHttpRouteError);
  });

  it('take a path function when the server starts, and check what it returns', async () => {
    const instance = await boot([routeClass({ method: 'GET', path: () => '/from-options' })]);

    expect(instance.getScopes()[0].httpRouteTable?.routes[0].path).toBe('/from-options');
    await expect(boot([routeClass({ method: 'GET', path: () => 'relative' })])).rejects.toThrow(InvalidHttpRouteError);
  });

  it.each([
    ['the legacy SSE path', { method: 'GET', path: '/sse' }],
    ['a discovery path', { method: 'GET', path: '/.well-known/thing' }],
    ['a POST on the MCP path', { method: 'POST', path: '/' }],
    ['a health probe', { method: 'GET', path: '/healthz' }],
  ] as const)('refuse %s', async (_case, metadata) => {
    await expect(boot([routeClass(metadata)])).rejects.toThrow(ReservedRouteCollisionError);
  });

  it('build no route table when nothing declares a route', async () => {
    const instance = await boot([]);

    expect(instance.getScopes()[0].httpRouteTable).toBeUndefined();
  });
});
