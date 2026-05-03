import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { executeOperation, type OpenApiRuntimeDeps } from '../executor/openapi-runtime';
import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import type { OutboundOptions } from '../skilled-openapi.types';

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

const baseOutbound = (overrides: Partial<OutboundOptions> = {}): OutboundOptions => ({
  allowPrivateNetworks: true,
  maxConcurrencyPerHost: 10,
  defaultTimeoutMs: 5_000,
  defaultMaxResponseBytes: 256 * 1024,
  allowHttp: true,
  ...overrides,
});

const buildEntry = (overrides: Partial<HiddenOpEntry['op']> = {}): HiddenOpEntry => ({
  skillId: 'billing',
  bundleVersion: 'v1',
  service: { id: 'svc', baseUrl: 'http://localhost:9999' },
  authBinding: { kind: 'bearer', vaultRef: 'stripe' },
  op: {
    operationId: 'createInvoice',
    serviceId: 'svc',
    httpMethod: 'POST',
    pathTemplate: '/v1/invoices/{id}',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, amount: { type: 'number' } },
      required: ['id'],
    },
    outputSchema: { type: 'object' },
    mapper: [
      { inputKey: 'id', type: 'path', key: 'id', required: true },
      { inputKey: 'amount', type: 'body', key: 'amount' },
    ],
    authBindingRef: 'def',
    ...overrides,
  },
});

const makeFetch = (options: {
  status?: number;
  body?: unknown;
  contentType?: string;
  capture?: (init: { url: string; method?: string; headers?: Headers; body?: unknown }) => void;
}) => {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = init?.headers as Headers | undefined;
    options.capture?.({ url, method: init?.method, headers, body: init?.body });
    const text = typeof options.body === 'string' ? options.body : JSON.stringify(options.body ?? {});
    return new Response(text, {
      status: options.status ?? 200,
      headers: { 'content-type': options.contentType ?? 'application/json' },
    });
  };
};

const buildDeps = (overrides: Partial<OpenApiRuntimeDeps> = {}): OpenApiRuntimeDeps => ({
  outbound: baseOutbound(),
  resolver: new MemoryCredentialResolver({ stripe: 'sk_live_x' }),
  allowedHosts: new Set(['localhost']),
  logger: fakeLogger,
  fetchImpl: makeFetch({ body: { ok: true } }) as never,
  ...overrides,
});

describe('executeOperation', () => {
  it('builds and sends a POST with bearer header + path interpolation + body', async () => {
    const calls: { url: string; method?: string; headers?: Headers; body?: unknown }[] = [];
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '42', amount: 100 },
      deps: buildDeps({
        fetchImpl: makeFetch({
          body: { id: 'inv_1' },
          capture: (c) => calls.push(c),
        }) as never,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls[0].url).toBe('http://localhost:9999/v1/invoices/42');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers?.get('Authorization')).toBe('Bearer sk_live_x');
    expect(JSON.parse(String(calls[0].body))).toEqual({ amount: 100 });
  });

  it('routes apiKey credential into the configured header', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'apiKey', in: 'header', name: 'X-Api-Key', vaultRef: 'k' };
    const calls: { headers?: Headers }[] = [];
    await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        resolver: new MemoryCredentialResolver({ k: 'apk_xyz' }),
        fetchImpl: makeFetch({ body: {}, capture: (c) => calls.push(c) }) as never,
      }),
    });
    expect(calls[0].headers?.get('X-Api-Key')).toBe('apk_xyz');
  });

  it('routes apiKey credential into a query parameter when configured', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'apiKey', in: 'query', name: 'api_key', vaultRef: 'k' };
    const calls: { url: string }[] = [];
    await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        resolver: new MemoryCredentialResolver({ k: 'apk_q' }),
        fetchImpl: makeFetch({ body: {}, capture: (c) => calls.push({ url: c.url }) }) as never,
      }),
    });
    expect(new URL(calls[0].url).searchParams.get('api_key')).toBe('apk_q');
  });

  it('returns auth error when bearer vaultRef does not resolve', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({ resolver: new MemoryCredentialResolver({}) }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth resolution failed/);
  });

  it('passthroughCallerToken uses the supplied caller token instead of the vault', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'bearer', vaultRef: 'unused', passthroughCallerToken: true };
    const calls: { headers?: Headers }[] = [];
    await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      callerToken: 'caller_jwt',
      deps: buildDeps({
        resolver: new MemoryCredentialResolver({}),
        fetchImpl: makeFetch({ body: {}, capture: (c) => calls.push(c) }) as never,
      }),
    });
    expect(calls[0].headers?.get('Authorization')).toBe('Bearer caller_jwt');
  });

  it('returns auth error when passthrough requested but no caller token', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'bearer', vaultRef: 'unused', passthroughCallerToken: true };
    const result = await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth resolution failed/);
  });

  it('rejects requests outside the host allowlist via SSRF guard', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({ allowedHosts: new Set(['allowed.example']) }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ssrf check/);
  });

  it('surfaces upstream 4xx/5xx as ok:false with the status preserved', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        fetchImpl: makeFetch({ status: 502, body: { error: 'upstream' } }) as never,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it('truncates / refuses responses larger than maxResponseBytes', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        outbound: baseOutbound({ defaultMaxResponseBytes: 16 }),
        fetchImpl: makeFetch({ body: 'x'.repeat(64), contentType: 'text/plain' }) as never,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/maxResponseBytes/);
  });

  it('returns ok:false when fetch itself rejects (e.g. ECONNREFUSED)', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        fetchImpl: (async () => {
          throw new Error('ECONNREFUSED');
        }) as never,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('routes oauth2 tokens via the bearer header', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'oauth2', flow: 'client_credentials', vaultRef: 'oat' };
    const calls: { headers?: Headers }[] = [];
    await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        resolver: new MemoryCredentialResolver({ oat: 'oauth_xxx' }),
        fetchImpl: makeFetch({ body: {}, capture: (c) => calls.push(c) }) as never,
      }),
    });
    expect(calls[0].headers?.get('Authorization')).toBe('Bearer oauth_xxx');
  });

  it('handles binding kind=none (no auth header)', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'none' };
    const calls: { headers?: Headers }[] = [];
    await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        fetchImpl: makeFetch({ body: {}, capture: (c) => calls.push(c) }) as never,
      }),
    });
    expect(calls[0].headers?.get('Authorization')).toBeNull();
  });

  it('fails with descriptive error when input is missing a required path param', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { amount: 10 }, // no `id`
      deps: buildDeps(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Required.*path.*'id'/i);
  });
});
