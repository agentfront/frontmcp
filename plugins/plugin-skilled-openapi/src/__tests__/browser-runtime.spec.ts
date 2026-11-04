import * as dns from 'node:dns';

import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { isBrowserPage, isBrowserRuntime } from '../executor/browser-runtime';
import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { executeOperation } from '../executor/openapi-runtime';
import { checkOutboundUrl } from '../executor/ssrf-guard';
import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import type { OutboundOptions } from '../skilled-openapi.types';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const runInBrowser = () => runtimeContext.mockImplementation(() => ({ ...realRuntimeContext(), runtime: 'browser' }));

const outbound = (overrides: Partial<OutboundOptions> = {}): OutboundOptions => ({
  allowPrivateNetworks: false,
  maxConcurrencyPerHost: 10,
  defaultTimeoutMs: 5_000,
  defaultMaxResponseBytes: 256 * 1024,
  allowHttp: false,
  errorBodies: 'include',
  ...overrides,
});

afterEach(() => {
  runtimeContext.mockImplementation(realRuntimeContext);
  jest.restoreAllMocks();
});

describe('isBrowserRuntime and isBrowserPage', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('report Node.js as neither', () => {
    expect([isBrowserRuntime(), isBrowserPage()]).toEqual([false, false]);
  });

  it('report a browser Web Worker, which has no document, as a browser but not a page', () => {
    runInBrowser();
    expect([isBrowserRuntime(), isBrowserPage()]).toEqual([true, false]);
  });

  it('report a browser page as both', () => {
    runInBrowser();
    (globalThis as { document?: unknown }).document = {};
    expect([isBrowserRuntime(), isBrowserPage()]).toEqual([true, true]);
  });
});

describe('checkOutboundUrl in a browser', () => {
  const allowedHosts = new Set(['billing.example', '10.0.0.7', '169.254.169.254', 'metadata.google.internal']);

  beforeEach(runInBrowser);

  it('allows a declared host without resolving it', async () => {
    const lookup = jest.spyOn(dns.promises, 'lookup');

    expect(await checkOutboundUrl('https://billing.example/v1/invoices/7', allowedHosts, outbound())).toEqual({
      ok: true,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['http://billing.example/v1', /forbidden scheme "http:"/],
    ['https://elsewhere.example/v1', /hostname "elsewhere.example" is not in the bundle's declared services/],
    ['https://metadata.google.internal/', /cloud metadata hostname "metadata.google.internal" is blocked/],
    ['https://10.0.0.7/v1', /private\/loopback IPv4 10\.0\.0\.7 .* is blocked/],
    ['https://169.254.169.254/latest', /metadata\/link-local IPv4 169\.254\.169\.254 .* is always blocked/],
  ])('still refuses %s', async (url, reason) => {
    const result = await checkOutboundUrl(url, allowedHosts, outbound());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it('still refuses a metadata address with allowPrivateNetworks, which lets the private one through', async () => {
    const allowPrivate = outbound({ allowPrivateNetworks: true });
    expect((await checkOutboundUrl('https://10.0.0.7/v1', allowedHosts, allowPrivate)).ok).toBe(true);
    expect((await checkOutboundUrl('https://169.254.169.254/latest', allowedHosts, allowPrivate)).ok).toBe(false);
  });
});

describe('checkOutboundUrl on Node.js and Workers', () => {
  it('fails closed when the name cannot be resolved', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('no resolver on this runtime'));

    expect(await checkOutboundUrl('https://billing.example/v1', new Set(['billing.example']), outbound())).toEqual({
      ok: false,
      reason: 'DNS resolution failed for "billing.example": no resolver on this runtime',
    });
  });
});

describe('executeOperation without Buffer, as in a browser', () => {
  const entry: HiddenOpEntry = {
    skillId: 'invoices',
    bundleId: 'acme:billing',
    bundleVersion: '1.0.0',
    service: { id: 'billing', baseUrl: 'https://billing.example/v1' },
    authBinding: { kind: 'none' },
    op: {
      operationId: 'getInvoice',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/invoices/{id}',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: { type: 'object' },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      authBindingRef: 'none',
    },
  };
  const chunkedJson = (...parts: string[]): typeof fetch =>
    (async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  const getInvoice = (fetchImpl: typeof fetch) =>
    executeOperation({
      entry,
      bundleId: 'acme:billing',
      input: { id: '7' },
      deps: {
        outbound: outbound({ allowPrivateNetworks: true }),
        resolver: new MemoryCredentialResolver({}),
        allowedHosts: new Set(['billing.example']),
        logger: { warn: jest.fn() } as never,
        fetchImpl,
      },
    });

  it('reads a body that arrives in several chunks', async () => {
    runInBrowser();
    await getInvoice(chunkedJson('{}'));
    const nodeBuffer = globalThis.Buffer;
    delete (globalThis as { Buffer?: unknown }).Buffer;
    try {
      expect(await getInvoice(chunkedJson('{"id":"7",', '"total":', '42}'))).toEqual({
        ok: true,
        status: 200,
        contentType: 'application/json',
        data: { id: '7', total: 42 },
        responseBytes: 21,
      });
    } finally {
      globalThis.Buffer = nodeBuffer;
    }
  });
});
