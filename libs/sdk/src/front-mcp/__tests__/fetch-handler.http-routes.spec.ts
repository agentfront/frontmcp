/**
 * `createFetchHandler()` serves `http.routes` (#819) the way the Express host does: the same handler, behind the
 * same `http:ip-filter` and `session:verify` flows. Before, the routes were logged as registered and answered 404.
 * A route on a health probe path fails startup, on both adapters.
 */
import 'reflect-metadata';

import {
  App,
  LogLevel,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type HttpRouteConfig,
  type ServerRequest,
  type ServerResponse,
} from '../../common';
import { ReservedRouteCollisionError } from '../../server/custom-routes.helper';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'routes', name: 'Routes', tools: [NoopTool] })
class RoutesApp {}

let releaseStream: () => void = () => undefined;

const routes: HttpRouteConfig[] = [
  {
    method: 'GET',
    path: '/hello/:name',
    handler: (req: ServerRequest, res: ServerResponse) => {
      res.status(200).json({ hello: req.params?.['name'] });
    },
  },
  {
    method: 'POST',
    path: '/connect-env',
    handler: (req: ServerRequest, res: ServerResponse) => {
      const secret = (req.body as { secret?: string } | undefined)?.secret;
      res.status(secret === 'sk-valid' ? 200 : 400).json({ connected: secret === 'sk-valid' });
    },
  },
  {
    method: 'GET',
    path: '/page',
    handler: (_req: ServerRequest, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send('<h1>custom page</h1>');
    },
  },
  {
    method: 'GET',
    path: '/passes-on',
    handler: (_req: ServerRequest, _res: ServerResponse, next) => next(),
  },
  {
    method: 'GET',
    path: '/events',
    handler: async (_req: ServerRequest, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
      await new Promise<void>((resolve) => (releaseStream = resolve));
      res.write('data: second\n\n');
      res.end();
    },
  },
  {
    method: 'GET',
    path: '/fails-midway',
    handler: async (_req: ServerRequest, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial');
      await Promise.resolve();
      throw new Error('the route failed after it started its response');
    },
  },
  {
    method: 'GET',
    path: '/whoami',
    auth: true,
    handler: (req: ServerRequest, res: ServerResponse) => {
      res.status(200).json({ hasAuthSession: Boolean(req.authSession) });
    },
  },
];

function fetchHandler(options: Partial<FrontMcpConfigInput> = {}) {
  return FrontMcpInstance.createFetchHandler({
    info: { name: 'fetch-routes', version: '1.0.0' },
    apps: [RoutesApp],
    logging: { level: LogLevel.Off },
    http: { routes },
    ...options,
  });
}

describe('createFetchHandler() with http.routes (#819)', () => {
  it('answers a custom route with its handler and its path parameters, not a 404', async () => {
    const handler = await fetchHandler();

    const response = await handler(new Request('http://localhost/hello/world'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ hello: 'world' });
  });

  it('hands a POST route its parsed JSON body', async () => {
    const handler = await fetchHandler();
    const post = (secret: string) =>
      handler(
        new Request('http://localhost/connect-env', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret }),
        }),
      );

    const accepted = await post('sk-valid');
    const refused = await post('nope');

    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ connected: true });
    expect(refused.status).toBe(400);
  });

  it('keeps the headers and body the handler wrote', async () => {
    const handler = await fetchHandler();

    const response = await handler(new Request('http://localhost/page'));

    expect(response.headers.get('content-type')).toContain('text/html');
    await expect(response.text()).resolves.toBe('<h1>custom page</h1>');
  });

  it('returns a streaming response once its head is written, while the handler still runs', async () => {
    const handler = await fetchHandler();
    const decoder = new TextDecoder();
    const timedOut = new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 1000));

    const response = await Promise.race([handler(new Request('http://localhost/events')), timedOut]);
    if (response === 'timed out') throw new Error('the response was held until the handler finished');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('the response has no body');
    const first = await reader.read();
    releaseStream();
    let rest = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += decoder.decode(chunk.value);

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(decoder.decode(first.value)).toBe('data: first\n\n');
    expect(rest).toBe('data: second\n\n');
  });

  it('errors the body of a response whose handler fails after starting it, not ending it as complete', async () => {
    const handler = await fetchHandler();

    const response = await handler(new Request('http://localhost/fails-midway'));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('the response has no body');

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('partial');
    await expect(reader.read()).rejects.toThrow('the route failed after it started its response');
  });

  it('answers 404 when the handler passes the request on, or the method does not match', async () => {
    const handler = await fetchHandler();

    expect((await handler(new Request('http://localhost/passes-on'))).status).toBe(404);
    expect((await handler(new Request('http://localhost/hello/world', { method: 'DELETE' }))).status).toBe(404);
  });

  it('runs an auth: true route behind session:verify', async () => {
    const handler = await fetchHandler({ auth: { mode: 'local' } });

    const response = await handler(new Request('http://localhost/whoami'));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('runs every route behind the http:ip-filter flow', async () => {
    const handler = await fetchHandler({ throttle: { enabled: true, ipFilter: { denyList: ['203.0.113.7'] } } });

    const denied = await handler(new Request('http://localhost/hello/world'), {
      remoteAddr: { hostname: '203.0.113.7' },
    });
    const allowed = await handler(new Request('http://localhost/hello/world'), {
      remoteAddr: { hostname: '198.51.100.1' },
    });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it.each(['/healthz', '/readyz'])('refuses a custom route on the health path %s', async (path) => {
    await expect(
      fetchHandler({ http: { routes: [{ method: 'GET', path, handler: (_req, res) => res.status(200).json({}) }] } }),
    ).rejects.toBeInstanceOf(ReservedRouteCollisionError);
  });

  it('refuses a custom route on a configured health path, and allows the default one it replaced', async () => {
    const onPath = (path: string) =>
      fetchHandler({
        health: { healthzPath: '/live' },
        http: { routes: [{ method: 'GET', path, handler: (_req, res) => res.status(200).json({}) }] },
      });

    await expect(onPath('/live')).rejects.toBeInstanceOf(ReservedRouteCollisionError);
    await expect(onPath('/healthz')).resolves.toEqual(expect.any(Function));
  });

  it('allows a route on a health path when health is off', async () => {
    const handler = await fetchHandler({
      health: { enabled: false },
      http: {
        routes: [{ method: 'GET', path: '/healthz', handler: (_req, res) => res.status(200).json({ mine: true }) }],
      },
    });

    await expect((await handler(new Request('http://localhost/healthz'))).json()).resolves.toEqual({ mine: true });
  });
});
