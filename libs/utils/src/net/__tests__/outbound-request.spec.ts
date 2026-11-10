import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';

import {
  OUTBOUND_MAX_REQUEST_BYTES,
  OUTBOUND_TIMEOUT_MS,
  outboundFailureCategory,
  sendOutboundRequest,
  type OutboundRequest,
  type OutboundResult,
} from '../outbound-request';

const mockIsNode = jest.fn(() => true);
jest.mock('../../crypto/runtime', () => ({
  ...jest.requireActual('../../crypto/runtime'),
  isNode: () => mockIsNode(),
}));

interface ReceivedRequest {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

type Answer = (request: IncomingMessage, response: ServerResponse) => void;

const respondWith =
  (status: number, body = '', headers: Record<string, string | string[]> = {}): Answer =>
  (_request, response) => {
    response.writeHead(status, headers);
    response.end(body);
  };

/** A body that only ends when the reader goes away, so an answer in time proves the reader stopped at its cap. */
const endlessBody: Answer = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  const writer = setInterval(() => response.write('0123456789'.repeat(100)), 2);
  response.on('close', () => clearInterval(writer));
};

const requests: ReceivedRequest[] = [];
let answer: Answer = respondWith(200, '{"ok":true}');
let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: request.method, path: request.url, headers: request.headers, body });
      answer(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests.length = 0;
  answer = respondWith(200, '{"ok":true}');
  mockIsNode.mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  server.closeAllConnections();
});

const localUrl = (path = '/hook') => `http://127.0.0.1:${port}${path}`;

const sendLocal = (overrides: Partial<OutboundRequest> = {}): Promise<OutboundResult> =>
  sendOutboundRequest({ url: localUrl(), allowLocal: true, timeoutMs: 2_000, ...overrides });

async function closedPort(): Promise<number> {
  const closing = http.createServer();
  await new Promise<void>((resolve) => closing.listen(0, '127.0.0.1', resolve));
  const { port: freedPort } = closing.address() as AddressInfo;
  await new Promise((resolve) => closing.close(resolve));
  return freedPort;
}

function resolveTo(...addresses: Array<[address: string, family: 4 | 6]>) {
  const answers = addresses.map(([address, family]) => ({ address, family }));
  return jest.spyOn(dns.promises, 'lookup').mockResolvedValue(answers as never);
}

function failingRequest(error: unknown) {
  const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
  outgoing.end = () => {
    queueMicrotask(() => outgoing.emit('error', error));
  };
  return outgoing;
}

function failHttpsRequestsWith(error: unknown) {
  return jest.spyOn(https, 'request').mockImplementation((() => failingRequest(error)) as never);
}

const errorWithCode = (code: string) => Object.assign(new Error('request failed'), { code });

describe('sendOutboundRequest on Node', () => {
  describe('a request that is answered', () => {
    it('POSTs the body as its exact UTF-8 bytes, with the given headers', async () => {
      const body = '{ "note" : "café ☕" }';

      const result = await sendLocal({ body, headers: { 'content-type': 'application/json', 'webhook-id': 'msg_1' } });

      expect(result).toEqual({ answered: true, status: 200, body: '', bodyTruncated: false, headers: {} });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ method: 'POST', path: '/hook', body });
      expect(requests[0].headers).toMatchObject({
        'content-type': 'application/json',
        'webhook-id': 'msg_1',
        'content-length': String(Buffer.byteLength(body)),
        host: `127.0.0.1:${port}`,
        connection: 'close',
      });
    });

    it('GETs when there is no body, and sends the method it is given', async () => {
      await sendLocal({ url: localUrl('/.well-known/mcp-webhook-receiver.json') });
      await sendLocal({ method: 'POST' });
      await sendLocal({ method: 'GET', headers: { accept: 'application/json' } });

      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET']);
      expect(requests[0].path).toBe('/.well-known/mcp-webhook-receiver.json');
      expect(requests[0].body).toBe('');
      expect(requests[2].headers.accept).toBe('application/json');
    });

    it('returns the body only up to maxResponseBytes', async () => {
      answer = respondWith(201, '{"challenge":"nonce-1"}');

      await expect(sendLocal({ maxResponseBytes: 1024 })).resolves.toEqual({
        answered: true,
        status: 201,
        body: '{"challenge":"nonce-1"}',
        bodyTruncated: false,
        headers: {},
      });
    });

    it('does not read the body unless asked to', async () => {
      answer = respondWith(200, 'x'.repeat(100_000));

      await expect(sendLocal()).resolves.toMatchObject({ status: 200, body: '', bodyTruncated: false });
      await expect(sendLocal({ maxResponseBytes: 0 })).resolves.toMatchObject({ body: '', bodyTruncated: false });
      await expect(sendLocal({ maxResponseBytes: -1 })).resolves.toMatchObject({ body: '', bodyTruncated: false });
    });

    it('cuts an oversized body at maxResponseBytes and stops reading', async () => {
      answer = endlessBody;

      const result = await sendLocal({ maxResponseBytes: 2_500 });

      expect(result).toMatchObject({ answered: true, status: 200, bodyTruncated: true });
      expect(result.answered && result.body).toBe('0123456789'.repeat(250));
    });

    it('keeps a body that is exactly maxResponseBytes whole', async () => {
      answer = respondWith(200, 'x'.repeat(64));

      await expect(sendLocal({ maxResponseBytes: 64 })).resolves.toMatchObject({
        body: 'x'.repeat(64),
        bodyTruncated: false,
      });
      await expect(sendLocal({ maxResponseBytes: 63 })).resolves.toMatchObject({
        body: 'x'.repeat(63),
        bodyTruncated: true,
      });
    });

    it('joins a body that arrives in several chunks', async () => {
      answer = (_request, response) => {
        response.writeHead(200);
        response.write('aaaa');
        setTimeout(() => response.write('bbbb'), 20);
        setTimeout(() => response.end('cccc'), 40);
      };

      await expect(sendLocal({ maxResponseBytes: 100 })).resolves.toMatchObject({
        body: 'aaaabbbbcccc',
        bodyTruncated: false,
      });
      await expect(sendLocal({ maxResponseBytes: 10 })).resolves.toMatchObject({
        body: 'aaaabbbbcc',
        bodyTruncated: true,
      });
    });

    it('returns an empty body for an answer without one', async () => {
      answer = respondWith(204);

      await expect(sendLocal({ maxResponseBytes: 1024 })).resolves.toMatchObject({
        status: 204,
        body: '',
        bodyTruncated: false,
      });
    });

    it('returns only the headers it is asked for, by lowercase name', async () => {
      answer = respondWith(200, '{}', {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300',
        'X-Internal-Trace': 'do-not-leak',
        'Set-Cookie': ['a=1', 'b=2'],
      });

      const asked = await sendLocal({ responseHeaders: ['Cache-Control', 'content-type', 'set-cookie', 'x-missing'] });
      const unasked = await sendLocal();

      expect(asked).toMatchObject({
        headers: { 'cache-control': 'max-age=300', 'content-type': 'application/json', 'set-cookie': 'a=1,b=2' },
      });
      expect(asked.answered && Object.keys(asked.headers)).toHaveLength(3);
      expect(unasked).toMatchObject({ headers: {} });
    });

    it('returns a redirect as it is, without following it', async () => {
      answer = (request, response) => {
        if (request.url === '/elsewhere') return respondWith(200, 'followed')(request, response);
        return respondWith(302, '', { location: localUrl('/elsewhere') })(request, response);
      };

      const result = await sendLocal({ body: '{}', maxResponseBytes: 1024, responseHeaders: ['location'] });

      expect(result).toMatchObject({ answered: true, status: 302, body: '' });
      expect(outboundFailureCategory(result)).toBe('http_4xx');
      expect(requests.map((request) => request.path)).toEqual(['/hook']);
    });

    it.each([301, 303, 307, 308])('does not follow a %i redirect to an internal address', async (status) => {
      answer = respondWith(status, '', { location: 'http://169.254.169.254/latest/meta-data/' });

      await expect(sendLocal({ body: '{}' })).resolves.toMatchObject({ answered: true, status });
      expect(requests).toHaveLength(1);
    });

    it.each([
      [200, undefined],
      [204, undefined],
      [400, 'http_4xx'],
      [404, 'http_4xx'],
      [410, 'http_4xx'],
      [413, 'http_4xx'],
      [429, 'http_4xx'],
      [500, 'http_5xx'],
      [503, 'http_5xx'],
    ])('answers with status %i, whose category is %s', async (status, category) => {
      answer = respondWith(status, 'upstream detail');

      const result = await sendLocal({ body: '{}' });

      expect(result).toEqual({ answered: true, status, body: '', bodyTruncated: false, headers: {} });
      expect(outboundFailureCategory(result)).toBe(category);
    });
  });

  describe('a request that fails', () => {
    it('reports no answer within the timeout as a timeout', async () => {
      answer = () => undefined;

      const result = await sendLocal({ body: '{}', timeoutMs: 100 });

      expect(result).toEqual({ answered: false, reason: 'timeout' });
      expect(outboundFailureCategory(result)).toBe('timeout');
      expect(requests).toHaveLength(1);
    });

    it('reports a body that stalls as a timeout, unless the body is not read', async () => {
      answer = (_request, response) => {
        response.writeHead(200);
        response.write('partial');
      };

      await expect(sendLocal({ maxResponseBytes: 1024, timeoutMs: 100 })).resolves.toEqual({
        answered: false,
        reason: 'timeout',
      });
      await expect(sendLocal({ timeoutMs: 100 })).resolves.toMatchObject({ answered: true, status: 200 });
    });

    it('ends as a timeout when the caller aborts', async () => {
      answer = () => undefined;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      await expect(sendLocal({ signal: controller.signal })).resolves.toEqual({ answered: false, reason: 'timeout' });
    });

    it('sends nothing when the caller has already aborted', async () => {
      const lookup = jest.spyOn(dns.promises, 'lookup');

      await expect(sendLocal({ signal: AbortSignal.abort() })).resolves.toEqual({ answered: false, reason: 'timeout' });
      expect(lookup).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    });

    it('answers normally when the signal it is given is never aborted', async () => {
      await expect(sendLocal({ signal: new AbortController().signal })).resolves.toMatchObject({ status: 200 });
    });

    it('reports a closed port as connection_refused', async () => {
      const result = await sendLocal({ url: `http://127.0.0.1:${await closedPort()}/hook`, body: '{}' });

      expect(result).toEqual({ answered: false, reason: 'connection_refused' });
      expect(outboundFailureCategory(result)).toBe('connection_refused');
    });

    it('reports a failed TLS handshake as tls_error', async () => {
      const result = await sendLocal({ url: `https://127.0.0.1:${port}/hook`, body: '{}' });

      expect(result).toEqual({ answered: false, reason: 'tls_error' });
      expect(outboundFailureCategory(result)).toBe('tls_error');
    });

    it.each([
      ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_error'],
      ['SELF_SIGNED_CERT_IN_CHAIN', 'tls_error'],
      ['CERT_HAS_EXPIRED', 'tls_error'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error'],
      ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_error'],
      ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls_error'],
      ['HOSTNAME_MISMATCH', 'tls_error'],
      ['INVALID_CA', 'tls_error'],
      ['PATH_LENGTH_EXCEEDED', 'tls_error'],
      ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls_error'],
      ['EPROTO', 'tls_error'],
      ['ETIMEDOUT', 'timeout'],
      ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
      ['ECONNREFUSED', 'connection_refused'],
      ['ECONNRESET', 'connection_refused'],
      ['EHOSTUNREACH', 'connection_refused'],
      ['ENETUNREACH', 'connection_refused'],
      ['EPIPE', 'connection_refused'],
      ['HPE_HEADER_OVERFLOW', 'connection_refused'],
    ])('reports the error code %s as %s', async (code, reason) => {
      resolveTo(['93.184.216.34', 4]);
      failHttpsRequestsWith(errorWithCode(code));

      await expect(sendOutboundRequest({ url: 'https://hooks.example.com/hook', body: '{}' })).resolves.toEqual({
        answered: false,
        reason,
      });
    });

    it.each([
      [
        'an error whose cause carries the code',
        new TypeError('fetch failed', { cause: errorWithCode('CERT_HAS_EXPIRED') }),
      ],
      ['an error without a code', new Error('socket hang up')],
      ['a thrown string', 'boom'],
      ['a thrown null', null],
    ])('reports %s without exposing it', async (_case, error) => {
      resolveTo(['93.184.216.34', 4]);
      failHttpsRequestsWith(error);

      const result = await sendOutboundRequest({ url: 'https://hooks.example.com/hook', body: '{}' });

      expect(result).toEqual({
        answered: false,
        reason: error instanceof TypeError ? 'tls_error' : 'connection_refused',
      });
      expect(Object.keys(result)).toEqual(['answered', 'reason']);
    });
  });

  describe('a request body over the cap', () => {
    it('is refused before anything is sent, counted in bytes', async () => {
      const lookup = jest.spyOn(dns.promises, 'lookup');
      const twelveBytes = 'é'.repeat(6);

      const refused = await sendLocal({ body: twelveBytes, maxRequestBytes: 11 });

      expect(refused).toEqual({ answered: false, reason: 'request_too_large' });
      expect(outboundFailureCategory(refused)).toBe('http_4xx');
      expect(lookup).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
      await expect(sendLocal({ body: twelveBytes, maxRequestBytes: 12 })).resolves.toMatchObject({ status: 200 });
    });

    it('defaults to 256 KiB', async () => {
      expect(OUTBOUND_MAX_REQUEST_BYTES).toBe(262_144);
      await expect(sendLocal({ body: 'x'.repeat(OUTBOUND_MAX_REQUEST_BYTES + 1) })).resolves.toEqual({
        answered: false,
        reason: 'request_too_large',
      });
      await expect(sendLocal({ body: 'x'.repeat(OUTBOUND_MAX_REQUEST_BYTES) })).resolves.toMatchObject({ status: 200 });
      expect(requests).toHaveLength(1);
    });
  });

  describe('a URL that is refused before any I/O', () => {
    it.each([
      ['http://hooks.example.com/hook', 'invalid_url'],
      [`http://127.0.0.1:1/hook`, 'invalid_url'],
      ['not a url', 'invalid_url'],
      ['ftp://hooks.example.com/hook', 'invalid_url'],
      ['https://user:password@hooks.example.com/hook', 'invalid_url'],
      ['https://127.0.0.1/hook', 'forbidden_address'],
      ['https://[::1]/hook', 'forbidden_address'],
      ['https://10.0.0.5/hook', 'forbidden_address'],
      ['https://192.168.1.10/hook', 'forbidden_address'],
      ['https://169.254.10.10/hook', 'forbidden_address'],
      ['https://169.254.169.254/latest/meta-data/', 'forbidden_address'],
      ['https://[::ffff:169.254.169.254]/latest/meta-data/', 'forbidden_address'],
      ['https://[::ffff:10.0.0.5]/hook', 'forbidden_address'],
      ['https://localhost/hook', 'forbidden_address'],
      ['https://metadata.google.internal/computeMetadata/v1/', 'forbidden_address'],
    ])('refuses %s as %s', async (url, reason) => {
      const lookup = jest.spyOn(dns.promises, 'lookup');
      const httpRequest = jest.spyOn(http, 'request');
      const httpsRequest = jest.spyOn(https, 'request');

      const result = await sendOutboundRequest({ url, body: '{}' });

      expect(result).toEqual({ answered: false, reason });
      expect(outboundFailureCategory(result)).toBe('connection_refused');
      expect(lookup).not.toHaveBeenCalled();
      expect(httpRequest).not.toHaveBeenCalled();
      expect(httpsRequest).not.toHaveBeenCalled();
    });

    it('refuses an internal target even with allowLocal when it is link-local or metadata', async () => {
      await expect(sendLocal({ url: 'http://169.254.169.254/latest/meta-data/' })).resolves.toEqual({
        answered: false,
        reason: 'forbidden_address',
      });
    });
  });

  describe('a hostname', () => {
    it.each([
      ['a private address', [['10.0.0.5', 4]]],
      ['a loopback address', [['127.0.0.1', 4]]],
      ['an IPv6 loopback address', [['::1', 6]]],
      ['a link-local address', [['169.254.10.10', 4]]],
      ['the cloud metadata address', [['169.254.169.254', 4]]],
      ['an IPv4-mapped private address', [['::ffff:10.0.0.5', 6]]],
      ['an IPv4-mapped metadata address', [['::ffff:a9fe:a9fe', 6]]],
      ['a unique local address', [['fd12:3456::1', 6]]],
      ['a documentation address', [['203.0.113.10', 4]]],
      [
        'a public and a private address',
        [
          ['93.184.216.34', 4],
          ['10.0.0.5', 4],
        ],
      ],
      [
        'a public IPv4 and a loopback IPv6 address',
        [
          ['93.184.216.34', 4],
          ['::1', 6],
        ],
      ],
      ['an address that is not one', [['not-an-address', 4]]],
    ] as Array<[string, Array<[string, 4 | 6]>]>)('that resolves to %s is refused', async (_case, addresses) => {
      const lookup = resolveTo(...addresses);
      const httpsRequest = jest.spyOn(https, 'request');

      const result = await sendOutboundRequest({ url: 'https://rebind.example.com/hook', body: '{}' });

      expect(result).toEqual({ answered: false, reason: 'forbidden_address' });
      expect(outboundFailureCategory(result)).toBe('connection_refused');
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledWith('rebind.example.com', { all: true });
      expect(httpsRequest).not.toHaveBeenCalled();
    });

    it('that resolves to link-local or metadata is refused even with allowLocal', async () => {
      resolveTo(['127.0.0.1', 4], ['169.254.169.254', 4]);

      await expect(sendLocal({ url: `http://hooks.test:${port}/hook` })).resolves.toEqual({
        answered: false,
        reason: 'forbidden_address',
      });
      expect(requests).toHaveLength(0);
    });

    it('that resolves to nothing is reported as unresolved_host', async () => {
      resolveTo();

      const result = await sendOutboundRequest({ url: 'https://hooks.example.com/hook' });

      expect(result).toEqual({ answered: false, reason: 'unresolved_host' });
      expect(outboundFailureCategory(result)).toBe('connection_refused');
    });

    it('that does not resolve is reported as unresolved_host', async () => {
      jest.spyOn(dns.promises, 'lookup').mockRejectedValue(errorWithCode('ENOTFOUND'));

      await expect(sendOutboundRequest({ url: 'https://missing.example.com/hook' })).resolves.toEqual({
        answered: false,
        reason: 'unresolved_host',
      });
    });

    it('whose resolution outlasts the timeout is reported as a timeout', async () => {
      jest.spyOn(dns.promises, 'lookup').mockReturnValue(new Promise(() => undefined) as never);
      const httpsRequest = jest.spyOn(https, 'request');

      await expect(sendOutboundRequest({ url: 'https://slow.example.com/hook', timeoutMs: 50 })).resolves.toEqual({
        answered: false,
        reason: 'timeout',
      });
      expect(httpsRequest).not.toHaveBeenCalled();
    });

    it('is resolved once, and the connection goes to the address that was checked', async () => {
      const lookup = jest
        .spyOn(dns.promises, 'lookup')
        .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never)
        .mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
      answer = respondWith(200, 'reached');

      const result = await sendLocal({ url: `http://hooks.test:${port}/hook`, body: '{}', maxResponseBytes: 16 });

      expect(result).toMatchObject({ answered: true, status: 200, body: 'reached' });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledWith('hooks.test', { all: true });
      expect(requests[0].headers.host).toBe(`hooks.test:${port}`);
    });

    it('with public addresses is requested by name, pinned to those addresses', async () => {
      const validated = [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ];
      resolveTo(['93.184.216.34', 4], ['2606:2800:220:1:248:1893:25c8:1946', 6]);
      const httpsRequest = failHttpsRequestsWith(errorWithCode('ECONNREFUSED'));

      const result = await sendOutboundRequest({ url: 'https://hooks.example.com:8443/hook?tenant=acme', body: '{}' });

      expect(result).toEqual({ answered: false, reason: 'connection_refused' });
      expect(httpsRequest).toHaveBeenCalledTimes(1);
      const [url, options] = httpsRequest.mock.calls[0] as unknown as [URL, https.RequestOptions];
      expect(url.href).toBe('https://hooks.example.com:8443/hook?tenant=acme');
      expect(options).toMatchObject({ method: 'POST', agent: false, headers: { 'content-length': '2' } });
      expect(options.signal).toBeInstanceOf(AbortSignal);

      const lookup = options.lookup as NonNullable<https.RequestOptions['lookup']>;
      const every = jest.fn();
      const one = jest.fn();
      lookup('attacker-controlled.example', { all: true }, every);
      lookup('attacker-controlled.example', {}, one);
      expect(every).toHaveBeenCalledWith(null, validated);
      expect(one).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    });

    it('in brackets is looked up without them', async () => {
      const lookup = jest.spyOn(dns.promises, 'lookup');
      const httpsRequest = failHttpsRequestsWith(errorWithCode('ECONNREFUSED'));

      await sendOutboundRequest({ url: 'https://[2606:4700::1111]/hook' });

      expect(lookup).toHaveBeenCalledWith('2606:4700::1111', { all: true });
      expect(httpsRequest).toHaveBeenCalledTimes(1);
    });
  });

  it('waits ten seconds by default', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    await sendOutboundRequest({ url: localUrl(), allowLocal: true });
    await sendLocal({ timeoutMs: 1_500 });

    expect(OUTBOUND_TIMEOUT_MS).toBe(10_000);
    expect(timeout.mock.calls).toEqual([[10_000], [1_500]]);
  });
});

describe('sendOutboundRequest without Node networking', () => {
  const runtimes: Array<[name: string, enter: () => void, leave: () => void]> = [
    ['a browser', () => mockIsNode.mockReturnValue(false), () => mockIsNode.mockReturnValue(true)],
    [
      'an edge runtime',
      () => Object.assign(globalThis, { EdgeRuntime: 'edge' }),
      () => Reflect.deleteProperty(globalThis, 'EdgeRuntime'),
    ],
  ];

  describe.each(runtimes)('in %s', (_runtime, enter, leave) => {
    let lookup: jest.SpyInstance;
    let httpRequest: jest.SpyInstance;

    beforeEach(() => {
      enter();
      lookup = jest.spyOn(dns.promises, 'lookup');
      httpRequest = jest.spyOn(http, 'request');
    });

    afterEach(() => {
      expect(lookup).not.toHaveBeenCalled();
      expect(httpRequest).not.toHaveBeenCalled();
      leave();
    });

    it('sends through fetch without following redirects, and leaves DNS to the platform', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      answer = respondWith(201, '{"challenge":"nonce-1"}', { 'content-type': 'application/json', 'x-other': '1' });
      const body = '{ "note" : "café ☕" }';

      const result = await sendLocal({
        url: `http://localhost:${port}/hook`,
        body,
        headers: { 'content-type': 'application/json' },
        maxResponseBytes: 1024,
        responseHeaders: ['Content-Type', 'x-missing'],
      });

      expect(result).toEqual({
        answered: true,
        status: 201,
        body: '{"challenge":"nonce-1"}',
        bodyTruncated: false,
        headers: { 'content-type': 'application/json' },
      });
      expect(requests[0]).toMatchObject({ method: 'POST', path: '/hook', body });
      expect(requests[0].headers['content-type']).toBe('application/json');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe(`http://localhost:${port}/hook`);
      expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('returns a redirect as it is', async () => {
      answer = respondWith(307, '', { location: localUrl('/elsewhere') });

      const result = await sendLocal({ body: '{}' });

      expect(result).toMatchObject({ answered: true, status: 307 });
      expect(outboundFailureCategory(result)).toBe('http_4xx');
      expect(requests.map((request) => request.path)).toEqual(['/hook']);
    });

    it('returns the status 0 of a redirect a browser hides, as a failure', async () => {
      const opaqueRedirect = { status: 0, type: 'opaqueredirect', headers: new Headers(), body: null };
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(opaqueRedirect as unknown as Response);

      const result = await sendOutboundRequest({ url: 'https://hooks.example.com/hook', maxResponseBytes: 64 });

      expect(result).toEqual({ answered: true, status: 0, body: '', bodyTruncated: false, headers: {} });
      expect(outboundFailureCategory(result)).toBe('http_4xx');
    });

    it('cuts an oversized body at maxResponseBytes and stops reading', async () => {
      answer = endlessBody;

      const result = await sendLocal({ maxResponseBytes: 2_500 });

      expect(result).toMatchObject({ answered: true, status: 200, bodyTruncated: true });
      expect(result.answered && result.body).toBe('0123456789'.repeat(250));
    });

    it('does not read the body unless asked to, with or without one', async () => {
      answer = respondWith(200, 'x'.repeat(100_000));
      await expect(sendLocal()).resolves.toMatchObject({ status: 200, body: '', bodyTruncated: false });

      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
      await expect(sendLocal()).resolves.toMatchObject({ status: 204, body: '', bodyTruncated: false });
    });

    it('reports no answer within the timeout, and a body that stalls, as a timeout', async () => {
      answer = () => undefined;
      await expect(sendLocal({ body: '{}', timeoutMs: 100 })).resolves.toEqual({ answered: false, reason: 'timeout' });

      answer = (_request, response) => {
        response.writeHead(200);
        response.write('partial');
      };
      await expect(sendLocal({ maxResponseBytes: 64, timeoutMs: 100 })).resolves.toEqual({
        answered: false,
        reason: 'timeout',
      });
    });

    it('reports a closed port as connection_refused', async () => {
      const result = await sendLocal({ url: `http://127.0.0.1:${await closedPort()}/hook` });

      expect(result).toEqual({ answered: false, reason: 'connection_refused' });
    });

    it.each([
      ['https://10.0.0.5/hook', 'forbidden_address'],
      ['https://169.254.169.254/latest/meta-data/', 'forbidden_address'],
      ['https://[::ffff:169.254.169.254]/hook', 'forbidden_address'],
      ['https://[::1]/hook', 'forbidden_address'],
      ['https://localhost/hook', 'forbidden_address'],
      ['http://hooks.example.com/hook', 'invalid_url'],
      ['https://user:password@hooks.example.com/hook', 'invalid_url'],
    ])('refuses %s as %s before fetching', async (url, reason) => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      await expect(sendOutboundRequest({ url, body: '{}' })).resolves.toEqual({ answered: false, reason });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe('outboundFailureCategory', () => {
  const answered = (status: number): OutboundResult => ({
    answered: true,
    status,
    body: '',
    bodyTruncated: false,
    headers: {},
  });

  it.each([200, 201, 202, 204, 299])('has no category for the success status %i', (status) => {
    expect(outboundFailureCategory(answered(status))).toBeUndefined();
  });

  it.each([0, 100, 199, 300, 301, 302, 304, 399, 400, 401, 403, 404, 410, 413, 429, 499])(
    'puts the status %i in http_4xx',
    (status) => {
      expect(outboundFailureCategory(answered(status))).toBe('http_4xx');
    },
  );

  it.each([500, 502, 503, 504, 599])('puts the status %i in http_5xx', (status) => {
    expect(outboundFailureCategory(answered(status))).toBe('http_5xx');
  });

  it.each([
    ['invalid_url', 'connection_refused'],
    ['forbidden_address', 'connection_refused'],
    ['unresolved_host', 'connection_refused'],
    ['connection_refused', 'connection_refused'],
    ['request_too_large', 'http_4xx'],
    ['timeout', 'timeout'],
    ['tls_error', 'tls_error'],
  ] as const)('puts the failure %s in %s', (reason, category) => {
    expect(outboundFailureCategory({ answered: false, reason })).toBe(category);
  });
});
