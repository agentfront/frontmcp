// The node:http host serves FrontMCP's own handlers without Express, and hands the rest to an Express app (#948).
import { gzipSync } from 'node:zlib';

import { sdkHttpHandler } from '../../sdk-http-handler';
import { NodeHttpHostAdapter } from '../node-http.host.adapter';
import { detectExpressFlavor } from '../node-http/flavor';
import { createNodeHttpHost } from '../polyfills/node-http-host';
import { send } from './node-http.host.parity';

const expressBuilt = (host: NodeHttpHostAdapter): boolean =>
  (host as unknown as { express?: unknown }).express !== undefined;
const portOf = (host: NodeHttpHostAdapter): number =>
  ((host as unknown as { httpServer: import('node:http').Server }).httpServer.address() as { port: number }).port;

const echo = sdkHttpHandler(async (req: { body?: unknown; query?: unknown }, res: { json(body: unknown): void }) => {
  res.json({ body: req.body ?? null, query: req.query ?? null });
});

describe('NodeHttpHostAdapter', () => {
  const hosts: NodeHttpHostAdapter[] = [];

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.stop(0)));
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  async function started(
    register: (host: NodeHttpHostAdapter) => void,
    major: 4 | 5 = 4,
  ): Promise<NodeHttpHostAdapter> {
    const host = new NodeHttpHostAdapter(undefined, { major });
    register(host);
    await host.start(0, '127.0.0.1');
    hosts.push(host);
    return host;
  }

  it('serves FrontMCP handlers and JSON bodies without building the Express app', async () => {
    const host = await started((h) => h.registerRoute('POST', '/mcp', echo as never));

    const answer = await send(portOf(host), {
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0"}',
    });
    const missing = await send(portOf(host), { method: 'GET', path: '/nowhere' });

    expect(JSON.parse(answer.body)).toEqual({ body: { jsonrpc: '2.0' }, query: {} });
    expect(missing.status).toBe(404);
    expect(expressBuilt(host)).toBe(false);
  });

  it.each([
    ['a form body', 200, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' }],
    // body-parser reads JSON in the UTF charsets only
    [
      'a JSON body in another charset',
      415,
      { headers: { 'content-type': 'application/json; charset=latin1' }, body: '{}' },
    ],
    [
      'a compressed JSON body',
      200,
      { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: gzipSync('{"a":1}') },
    ],
    ['a query string under Express 4', 200, { path: '/mcp?a[b]=1' }],
  ])('hands %s to the Express app', async (_name, status, exchange) => {
    const host = await started((h) => h.registerRoute('POST', '/mcp', echo as never));

    const answer = await send(portOf(host), { method: 'POST', path: '/mcp', ...exchange });

    expect(answer.status).toBe(status);
    expect(expressBuilt(host)).toBe(true);
  });

  it('parses a query string itself under Express 5', async () => {
    const host = await started((h) => h.registerRoute('POST', '/mcp', echo as never), 5);

    const answer = await send(portOf(host), { method: 'POST', path: '/mcp?a=1&a=2' });

    expect(JSON.parse(answer.body).query).toEqual({ a: ['1', '2'] });
    expect(expressBuilt(host)).toBe(false);
  });

  it('builds the Express app at start for a server with a handler of its own', async () => {
    const host = await started((h) => {
      h.registerRoute('POST', '/mcp', echo as never);
      h.registerRoute('GET', '/custom', ((_req: unknown, res: { json(body: unknown): void }) =>
        res.json({ own: true })) as never);
    });

    expect(expressBuilt(host)).toBe(true);
    expect(JSON.parse((await send(portOf(host), { method: 'GET', path: '/custom' })).body)).toEqual({ own: true });
  });

  it('hands every request to the Express app once a handler of its own is added after start', async () => {
    const host = await started((h) => h.registerRoute('POST', '/mcp', echo as never));
    host.registerMiddleware('', ((_req: unknown, _res: unknown, next: () => void) => next()) as never);

    await send(portOf(host), {
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(expressBuilt(host)).toBe(true);
  });

  it('hands a path its router does not match as Express does to the Express app', async () => {
    const host = await started((h) => h.registerRoute('GET', '/files/*', echo as never));

    expect(expressBuilt(host)).toBe(true);
  });

  it('gives the Express app to a serverless platform', () => {
    const host = new NodeHttpHostAdapter(undefined, { major: 4 });
    host.registerRoute('POST', '/mcp', echo as never);

    const handler = host.getHandler() as { handle?: unknown; listen?: unknown };

    expect(typeof handler.handle).toBe('function');
    expect(typeof handler.listen).toBe('function');
  });

  it('refuses a Host its listener does not answer to', async () => {
    const host = await started((h) => h.registerRoute('GET', '/mcp', echo as never));

    const answer = await send(portOf(host), { method: 'GET', path: '/mcp', headers: { host: 'evil.example.com' } });

    expect(answer.status).toBe(403);
  });
});

describe('the Express the node:http host stands in for', () => {
  it('is the workspace Express 4 with body-parser 2', () => {
    expect(detectExpressFlavor()).toEqual({ major: 4 });
  });

  it('gives a node:http host for it', () => {
    expect(createNodeHttpHost({})).toBeInstanceOf(NodeHttpHostAdapter);
  });
});
