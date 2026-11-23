/**
 * A request connects to the addresses the outbound check resolved and judged, never to the answer of
 * a second lookup. The hosts here are `.test` names, which no resolver answers: a request that
 * reaches the local server was sent to the checked address, and one that looked the name up fails.
 */
import * as dns from 'node:dns';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import * as net from 'node:net';

import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { executeOperation, type OpenApiRuntimeDeps } from '../executor/openapi-runtime';
import type { HiddenOpEntry } from '../registry/hidden-op.registry';

const LOOPBACK = [{ address: '127.0.0.1', family: 4 }];

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

describe('executeOperation without an injected fetch', () => {
  const entry: HiddenOpEntry = {
    skillId: 'billing',
    bundleId: 'test:bundle',
    bundleVersion: 'v1',
    service: { id: 'svc', baseUrl: 'http://api.billing.test' },
    authBinding: { kind: 'bearer', vaultRef: 'billing' },
    op: {
      operationId: 'getInvoice',
      serviceId: 'svc',
      httpMethod: 'GET',
      pathTemplate: '/v1/invoices/{id}',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: { type: 'object' },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      authBindingRef: 'def',
    },
  };

  const deps = (outbound: Partial<OpenApiRuntimeDeps['outbound']> = {}): OpenApiRuntimeDeps => ({
    outbound: {
      allowPrivateNetworks: true,
      allowHttp: true,
      maxConcurrencyPerHost: 10,
      defaultTimeoutMs: 5_000,
      defaultMaxResponseBytes: 256 * 1024,
      errorBodies: 'include',
      ...outbound,
    },
    resolver: new MemoryCredentialResolver({ billing: 'sk_live_x' }),
    allowedHosts: new Set(['api.billing.test']),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  });

  const getInvoice = (runtimeDeps = deps()) =>
    executeOperation({
      entry: { ...entry, service: { ...entry.service, baseUrl: `http://api.billing.test:${port}` } },
      bundleId: 'acme',
      input: { id: '42' },
      deps: runtimeDeps,
    });

  it('sends the request to the address the outbound check resolved', async () => {
    const checkLookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue(LOOPBACK as never);

    const result = await getInvoice();

    expect(checkLookup).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, status: 200, data: { id: 'inv_1' } });
    expect(received).toEqual([
      expect.objectContaining({
        method: 'GET',
        url: '/v1/invoices/42',
        headers: expect.objectContaining({ host: `api.billing.test:${port}`, authorization: 'Bearer sk_live_x' }),
      }),
    ]);
  });

  it('sends nothing when the address the check resolved is refused', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);

    const result = await getInvoice();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/resolved to metadata\/link-local/);
    expect(received).toHaveLength(0);
  });

  it('reports a 204 answer as a success', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue(LOOPBACK as never);
    respond = (response) => {
      response.statusCode = 204;
      response.end();
    };

    const result = await getInvoice();

    expect(result).toMatchObject({ ok: true, status: 204, data: null });
  });

  it('closes the connection of a response over maxResponseBytes', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue(LOOPBACK as never);
    respond = (response) => {
      const chunk = Buffer.alloc(64 * 1024, 120);
      const writeUntilFull = () => {
        while (response.write(chunk));
      };
      response.on('drain', writeUntilFull);
      writeUntilFull();
    };

    const result = await getInvoice(deps({ defaultMaxResponseBytes: 1024 }));

    expect(result.error).toBe('response exceeded maxResponseBytes (1024)');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(openSockets.size).toBe(0);
  });

  it('reports a timeout when the response stalls part way through its body', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue(LOOPBACK as never);
    respond = (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"id":');
    };

    const result = await getInvoice(deps({ defaultTimeoutMs: 100 }));

    expect(result).toMatchObject({ ok: false, error: 'timeout after 100ms' });
  });
});
