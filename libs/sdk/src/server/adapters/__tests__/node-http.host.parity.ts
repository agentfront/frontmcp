// Runs the same handlers on ExpressHostAdapter and NodeHttpHostAdapter and compares every response (#948).
// Shared by the parity specs of Express 4 and Express 5.
import * as http from 'node:http';
import { gzipSync } from 'node:zlib';

import type { ServerRequest, ServerRequestHandler, ServerResponse } from '../../../common';
import { sdkHttpHandler } from '../../sdk-http-handler';
import { ExpressHostAdapter } from '../express.host.adapter';
import type { ExpressHostAdapterOptions } from '../host-adapter.shared';
import { NodeHttpHostAdapter, type ExpressFlavor } from '../node-http.host.adapter';

export interface Exchange {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Send `Content-Length` with this value instead of the body's length. */
  contentLength?: number;
}

export interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const IGNORED_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);

export function send(port: number, exchange: Exchange): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const body = typeof exchange.body === 'string' ? Buffer.from(exchange.body) : exchange.body;
    const headers: Record<string, string | number> = { host: `127.0.0.1:${port}`, ...exchange.headers };
    if (body !== undefined) headers['content-length'] = exchange.contentLength ?? body.length;
    const req = http.request(
      { host: '127.0.0.1', port, method: exchange.method, path: exchange.path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const kept: Answer['headers'] = {};
          for (const [name, value] of Object.entries(res.headers)) if (!IGNORED_HEADERS.has(name)) kept[name] = value;
          resolve({ status: res.statusCode ?? 0, headers: kept, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

/** What a request looks like to a handler, as a JSON-friendly record. */
export function describeRequest(req: ServerRequest): Record<string, unknown> {
  const request = req as ServerRequest & { baseUrl?: string; originalUrl?: string };
  return {
    url: request.url,
    path: request.path,
    baseUrl: request.baseUrl,
    originalUrl: request.originalUrl,
    params: request.params,
    query: request.query === undefined ? '<undefined>' : { ...request.query },
    hasBody: 'body' in request,
    body: request.body === undefined ? '<undefined>' : Buffer.isBuffer(request.body) ? '<buffer>' : request.body,
    bodyBytes: request.bodyBytes ? request.bodyBytes.length : '<none>',
  };
}

type Register = (host: {
  registerRoute: ExpressHostAdapter['registerRoute'];
  registerMiddleware: ExpressHostAdapter['registerMiddleware'];
}) => void;

/** The handlers FrontMCP's flows and routes stand for: the router's paths and the response helpers. */
export const sdkLikeRoutes: Register = (host) => {
  const mark = (handler: ServerRequestHandler) => sdkHttpHandler(handler);
  host.registerMiddleware(
    '',
    mark((req, res, next) => {
      switch (req.path) {
        case '/echo':
          res.status(200).json(describeRequest(req));
          return;
        case '/text':
          res.status(201).send('plain <b>text</b>');
          return;
        case '/buffer':
          res.send(Buffer.from('bytes'));
          return;
        case '/uint8':
          res.send(new Uint8Array([104, 105]));
          return;
        case '/status-float':
          res.status(200.5).json({ odd: true });
          return;
        case '/object':
          res.send({ a: 1, list: [1, 2] });
          return;
        case '/null':
          res.json(null);
          return;
        case '/empty':
          res.status(204).send('gone');
          return;
        case '/reset':
          res.status(205).send('reset');
          return;
        case '/typed':
          res.setHeader('Content-Type', 'text/plain');
          res.send('typed');
          return;
        case '/raw':
          res.writeHead(202, { 'x-raw': 'yes' });
          res.end('raw');
          return;
        case '/throw':
          throw Object.assign(new Error('handler failed'), { status: 418 });
        case '/throw-plain':
          throw new Error('plain failure');
        case '/next-error':
          (next as (err: unknown) => void)(
            Object.assign(new Error('teapot'), { statusCode: 503, headers: { 'retry-after': '5' } }),
          );
          return;
        case '/redirect':
          res.redirect('/elsewhere?x=1&y=<2>');
          return;
        case '/redirect-301':
          res.redirect(301, 'https://example.com/a b');
          return;
        default:
          next();
      }
    }),
  );
  host.registerMiddleware(
    '/oauth/authorize',
    mark((req, res, next) => {
      if (req.method === 'PUT') {
        res.json({ mounted: describeRequest(req) });
        return;
      }
      next();
    }),
  );
  host.registerMiddleware(
    '/oauth/provider/:providerId/callback',
    mark((req, res, next) => {
      if (req.method === 'PATCH') {
        res.json({ provider: describeRequest(req) });
        return;
      }
      next();
    }),
  );
  host.registerRoute(
    'GET',
    '/healthz',
    mark(async (_req, res) => {
      res.status(200).json({ status: 'ok' });
    }),
  );
  host.registerRoute(
    'POST',
    '/healthz',
    mark(async (req, res) => {
      res.status(200).json(describeRequest(req));
    }),
  );
  host.registerRoute(
    'GET',
    '/items/:id',
    mark((req, res) => {
      res.json(describeRequest(req));
    }),
  );
  host.registerRoute(
    'DELETE',
    '/items/:id',
    mark((_req, res) => {
      (res as ServerResponse).status(200).end();
    }),
  );
};

const json = (value: unknown): Exchange['body'] => JSON.stringify(value);

/** The requests both hosts answer. */
export const EXCHANGES: Exchange[] = [
  { method: 'GET', path: '/echo' },
  { method: 'GET', path: '/ECHO' },
  { method: 'GET', path: '/echo/' },
  { method: 'HEAD', path: '/echo' },
  { method: 'GET', path: '/echo?' },
  { method: 'GET', path: '/echo?a=1&a=2&b=x%20y&c=+&d' },
  { method: 'GET', path: '/echo?nested[a]=1&list[]=2' },
  { method: 'GET', path: '/text' },
  { method: 'HEAD', path: '/text' },
  { method: 'GET', path: '/buffer' },
  { method: 'GET', path: '/uint8' },
  { method: 'GET', path: '/status-float' },
  { method: 'GET', path: '/object' },
  { method: 'GET', path: '/null' },
  { method: 'GET', path: '/empty' },
  { method: 'GET', path: '/reset' },
  { method: 'GET', path: '/typed' },
  { method: 'GET', path: '/raw' },
  { method: 'GET', path: '/throw' },
  { method: 'GET', path: '/throw-plain' },
  { method: 'GET', path: '/next-error' },
  { method: 'HEAD', path: '/next-error' },
  { method: 'GET', path: '/redirect' },
  { method: 'GET', path: '/redirect', headers: { accept: 'text/html' } },
  { method: 'GET', path: '/redirect', headers: { accept: 'application/json' } },
  { method: 'HEAD', path: '/redirect-301' },
  { method: 'GET', path: '/redirect-301', headers: { accept: 'text/plain' } },
  { method: 'GET', path: '/nowhere' },
  { method: 'POST', path: '/nowhere', headers: { 'content-type': 'application/json' }, body: json({ a: 1 }) },
  { method: 'GET', path: '/a%20b/<script>' },
  { method: 'OPTIONS', path: '/healthz' },
  { method: 'OPTIONS', path: '/items/1' },
  { method: 'OPTIONS', path: '/nowhere' },
  { method: 'GET', path: '/healthz' },
  { method: 'HEAD', path: '/healthz' },
  { method: 'GET', path: '/HealthZ/' },
  { method: 'PUT', path: '/healthz' },
  { method: 'GET', path: '/healthz', headers: { 'if-none-match': 'W/"f-VaSQ4oDUiZblZNAEkkN+sX+q3Sg"' } },
  { method: 'GET', path: '/items/a%2Fb' },
  { method: 'GET', path: '/items/%E0%A4%A' },
  { method: 'GET', path: '/items/' },
  { method: 'DELETE', path: '/items/7' },
  { method: 'PUT', path: '/oauth/authorize' },
  { method: 'PUT', path: '/oauth/authorize/' },
  { method: 'PUT', path: '/OAuth/Authorize/next/step' },
  { method: 'PUT', path: '/oauth/authorizex' },
  { method: 'PATCH', path: '/oauth/provider/git%20hub/callback/extra' },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json' }, body: json({ a: [1, 'b'] }) },
  {
    method: 'POST',
    path: '/healthz',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json({ bom: true }) as string)]),
  },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json' }, body: '' },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json' }, body: '  ' },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json' }, body: '"string"' },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json' }, body: '{"broken": ' },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(2_000) },
  {
    method: 'POST',
    path: '/healthz',
    headers: { 'content-type': 'application/json; charset=latin1' },
    body: json({ a: 'é' }),
  },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/json; charset=utf-16' }, body: json({}) },
  {
    method: 'POST',
    path: '/healthz',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'a=1&b[c]=2',
  },
  {
    method: 'POST',
    path: '/healthz',
    headers: { 'content-type': 'application/json, application/x-www-form-urlencoded' },
    body: 'grant_type=x',
  },
  {
    method: 'POST',
    path: '/healthz',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body: gzipSync(Buffer.from(json({ zipped: true }) as string)),
  },
  {
    method: 'POST',
    path: '/healthz',
    headers: { 'content-type': 'application/json', 'content-encoding': 'bogus' },
    body: '{}',
  },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'text/plain' }, body: 'hello' },
  { method: 'POST', path: '/healthz', headers: { 'content-type': 'application/vnd.api+json' }, body: '{}' },
  { method: 'POST', path: '/healthz' },
  { method: 'DELETE', path: '/healthz', headers: { 'content-type': 'application/json' }, body: '{}' },
  { method: 'GET', path: '/echo', headers: { host: 'evil.example.com' } },
  { method: 'GET', path: '/echo', headers: { origin: 'https://evil.example.com' } },
  {
    method: 'OPTIONS',
    path: '/echo',
    headers: { origin: 'http://127.0.0.1', 'access-control-request-method': 'POST' },
  },
];

export interface HostPair {
  express: number;
  native: number;
  close(): Promise<void>;
}

/** Starts an Express host and a node:http host with the same options and handlers. */
export async function startPair(
  flavor: ExpressFlavor,
  options: ExpressHostAdapterOptions | undefined,
  register: Register,
): Promise<HostPair> {
  const expressHost = new ExpressHostAdapter(options);
  const nativeHost = new NodeHttpHostAdapter(options, flavor);
  register(expressHost);
  register(nativeHost);
  await expressHost.start(0, '127.0.0.1');
  await nativeHost.start(0, '127.0.0.1');
  const portOf = (host: object) =>
    ((host as unknown as { httpServer: http.Server }).httpServer.address() as { port: number }).port;
  return {
    express: portOf(expressHost),
    native: portOf(nativeHost),
    async close() {
      await Promise.all([expressHost.stop(0), nativeHost.stop(0)]);
    },
  };
}

/** The answer with this pair's port written as `<port>`, so the two hosts' answers compare. */
export function normalized(answer: Answer, port: number): Answer {
  const text = JSON.stringify(answer).split(String(port)).join('<port>');
  return JSON.parse(text) as Answer;
}
