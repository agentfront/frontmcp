/**
 * A request connects to the addresses it was given, never to the answer of a second lookup. The hosts
 * here are `.test` names, which no resolver answers: a request that reaches the local server was sent
 * to the given address, and one that looked the name up fails.
 */
import * as dns from 'node:dns';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import * as net from 'node:net';
import * as zlib from 'node:zlib';

import { pinnedFetch } from '../pinned-fetch';

const LOOPBACK = [{ address: '127.0.0.1', family: 4 }];
const JSON_BODY = Buffer.from(JSON.stringify({ id: 'inv_1' }));

interface ReceivedRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let port: number;
let received: ReceivedRequest[];
const openSockets = new Set<net.Socket>();
let respond: (response: import('node:http').ServerResponse) => void;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      respond(response);
    });
  });
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  respond = (response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('set-cookie', ['a=1', 'b=2']);
    response.end(JSON.stringify({ id: 'inv_1' }));
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pinnedFetch', () => {
  it('connects to the given address and keeps the hostname in Host', async () => {
    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/v1/items?page=2`, {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', authorization: 'Bearer token' }),
      body: '{"amount":100}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('set-cookie')).toBe('a=1, b=2');
    await expect(response.json()).resolves.toEqual({ id: 'inv_1' });
    expect(received).toEqual([
      {
        method: 'POST',
        url: '/v1/items?page=2',
        body: '{"amount":100}',
        headers: expect.objectContaining({
          host: `api.pinned.test:${port}`,
          authorization: 'Bearer token',
          'content-type': 'application/json',
          'content-length': '14',
          accept: '*/*',
          'accept-encoding': 'gzip, deflate',
          'user-agent': 'node',
        }),
      },
    ]);
  });

  it('does not look the hostname up again', async () => {
    const lookup = jest.spyOn(dns, 'lookup');

    await (await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`)).text();

    expect(lookup).not.toHaveBeenCalled();
  });

  it('answers a connection that asks for one address rather than all of them', async () => {
    const autoSelectFamily = net.getDefaultAutoSelectFamily();
    net.setDefaultAutoSelectFamily(false);
    try {
      const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);
      expect(response.status).toBe(200);
      await response.text();
    } finally {
      net.setDefaultAutoSelectFamily(autoSelectFamily);
    }
  });

  it('keeps accept and user-agent the request sets', async () => {
    await (
      await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`, {
        headers: { accept: 'application/xml', 'user-agent': 'billing-client' },
      })
    ).text();

    expect(received[0].headers).toMatchObject({ accept: 'application/xml', 'user-agent': 'billing-client' });
  });

  it.each([
    ['gzip', zlib.gzipSync],
    ['x-gzip', zlib.gzipSync],
    ['deflate', zlib.deflateSync],
    ['br', zlib.brotliCompressSync],
  ])('decodes a %s body', async (encoding, compress) => {
    respond = (response) => {
      response.setHeader('content-type', 'application/json');
      response.setHeader('content-encoding', encoding);
      response.end(compress(Buffer.from(JSON.stringify({ id: 'inv_1' }))));
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);

    await expect(response.json()).resolves.toEqual({ id: 'inv_1' });
  });

  it.each([
    ['empty', Buffer.alloc(0), ''],
    ['truncated', zlib.gzipSync(Buffer.from('{"id":"inv_1"}')).subarray(0, -6), '{"id":"inv_1"}'],
  ])('reads an %s gzip body as fetch does', async (_label, body, expected) => {
    respond = (response) => {
      response.setHeader('content-encoding', 'gzip');
      response.end(body);
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);

    await expect(response.text()).resolves.toBe(expected);
  });

  it.each([
    [
      'decodes a chain of codings, last applied first',
      'gzip, br',
      zlib.brotliCompressSync(zlib.gzipSync(JSON_BODY)),
      JSON_BODY,
    ],
    [
      'leaves a body as sent when a coding is unknown',
      'gzip, compress',
      zlib.gzipSync(JSON_BODY),
      zlib.gzipSync(JSON_BODY),
    ],
  ])('%s', async (_label, encoding, body, expected) => {
    respond = (response) => {
      response.setHeader('content-encoding', encoding);
      response.end(body);
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);

    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  });

  it.each([
    ['zlib-wrapped', zlib.deflateSync],
    ['raw', zlib.deflateRawSync],
  ])('decodes a %s deflate body, as fetch does', async (_label, compress) => {
    respond = (response) => {
      response.setHeader('content-encoding', 'deflate');
      response.end(compress(JSON_BODY));
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);

    await expect(response.json()).resolves.toEqual({ id: 'inv_1' });
  });

  it('refuses a URL with credentials before connecting, as fetch does', async () => {
    await expect(pinnedFetch(LOOPBACK)(`http://user:secret@api.pinned.test:${port}/`)).rejects.toThrow(TypeError);

    expect(received).toHaveLength(0);
  });

  it('connects to an IP-literal host only when it is one of the pinned addresses', async () => {
    await expect(pinnedFetch([{ address: '203.0.113.9', family: 4 }])(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      '127.0.0.1 is not among the addresses this fetch connects to',
    );
    expect(received).toHaveLength(0);

    const response = await pinnedFetch(LOOPBACK)(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    await response.text();
  });

  it('refuses a response with more content codings than fetch allows', async () => {
    respond = (response) => {
      response.setHeader('content-encoding', 'gzip, gzip, gzip, gzip, gzip, gzip');
      response.end('');
    };

    await expect(pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`)).rejects.toThrow(
      'too many content-encodings in response: 6, at most 5',
    );
  });

  it('fails reading a body that does not decode', async () => {
    respond = (response) => {
      response.setHeader('content-encoding', 'gzip');
      response.end('not gzip');
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);

    await expect(response.text()).rejects.toThrow();
  });

  it('returns a 204 with no body', async () => {
    respond = (response) => {
      response.statusCode = 204;
      response.end();
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`, { method: 'DELETE' });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('returns a HEAD response with no body, whatever its content-encoding', async () => {
    respond = (response) => {
      response.setHeader('content-encoding', 'gzip');
      response.setHeader('content-length', '120');
      response.end();
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    await expect(response.text()).resolves.toBe('');
  });

  it('returns a redirect as it is, without following it', async () => {
    respond = (response) => {
      response.statusCode = 302;
      response.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
      response.end();
    };

    const response = await pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`);

    expect(response.status).toBe(302);
    expect(received).toHaveLength(1);
  });

  it('rejects with an AbortError when the signal aborts', async () => {
    respond = () => undefined;
    const controller = new AbortController();

    const pending = pinnedFetch(LOOPBACK)(`http://api.pinned.test:${port}/`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
