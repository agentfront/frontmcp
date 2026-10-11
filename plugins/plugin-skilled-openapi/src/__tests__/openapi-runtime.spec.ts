import { base64urlEncode } from '@frontmcp/utils';

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

/** An (unsigned) JWT with these claims. */
const jwtWith = (claims: Record<string, unknown>): string => {
  const part = (value: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.sig`;
};

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
  bundleId: 'test:bundle',
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
    const callerJwt = jwtWith({ sub: 'u1', resource: 'http://localhost:9999' });
    const calls: { headers?: Headers }[] = [];
    await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      callerToken: callerJwt,
      deps: buildDeps({
        resolver: new MemoryCredentialResolver({}),
        fetchImpl: makeFetch({ body: {}, capture: (c) => calls.push(c) }) as never,
      }),
    });
    expect(calls[0].headers?.get('Authorization')).toBe(`Bearer ${callerJwt}`);
  });

  it('passthroughCallerToken refuses a caller token not issued for the service', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'bearer', vaultRef: 'unused', passthroughCallerToken: true };
    const fetchImpl = jest.fn();
    const result = await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      callerToken: jwtWith({ sub: 'u1', aud: 'https://mcp.example.com' }),
      deps: buildDeps({ fetchImpl: fetchImpl as never }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/passthrough caller token refused: the caller token was not issued for/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('labels a JSON body application/json, and keeps a content-type the request already carries', async () => {
    const sentTypes: Array<string | null | undefined> = [];
    const capture = (c: { headers?: Headers }) => sentTypes.push(c.headers?.get('content-type'));
    await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1', amount: 5 },
      deps: buildDeps({ fetchImpl: makeFetch({ body: {}, capture }) as never }),
    });
    const withHeader = buildEntry({
      mapper: [
        { inputKey: 'id', type: 'path', key: 'id', required: true },
        { inputKey: 'amount', type: 'body', key: 'amount' },
        { inputKey: 'ct', type: 'header', key: 'Content-Type' },
      ],
    });
    await executeOperation({
      entry: withHeader,
      bundleId: 'acme',
      input: { id: '1', amount: 5, ct: 'application/merge-patch+json' },
      deps: buildDeps({ fetchImpl: makeFetch({ body: {}, capture }) as never }),
    });
    // No body, no content-type.
    await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({ fetchImpl: makeFetch({ body: {}, capture }) as never }),
    });

    expect(sentTypes).toEqual(['application/json', 'application/merge-patch+json', null]);
  });

  it('returns a failure, sending nothing, when the body cannot be serialized', async () => {
    const fetchImpl = jest.fn();
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1', amount: BigInt(5) as unknown as number },
      deps: buildDeps({ fetchImpl: fetchImpl as never }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/request body serialization failed/);
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it('returns auth error when apiKey vaultRef does not resolve', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'apiKey', in: 'header', name: 'X-Api-Key', vaultRef: 'missing' };
    const result = await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({ resolver: new MemoryCredentialResolver({}) }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth resolution failed/);
    expect(result.error).toMatch(/apiKey vaultRef "missing" did not resolve/);
  });

  it('returns auth error when oauth2 vaultRef does not resolve', async () => {
    const entry = buildEntry();
    entry.authBinding = { kind: 'oauth2', flow: 'client_credentials', vaultRef: 'missing' };
    const result = await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({ resolver: new MemoryCredentialResolver({}) }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth resolution failed/);
    expect(result.error).toMatch(/oauth2 vaultRef "missing" did not resolve/);
  });

  it('refuses an upstream 3xx redirect instead of following it (credential-exfiltration guard)', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({
        // 302 with no body — the runtime must surface it as a failure, never follow.
        fetchImpl: (async () =>
          new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } })) as never,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.error).toMatch(/redirect/);
    expect(result.error).toMatch(/not followed/);
  });

  it('refuses an opaque redirect (status 0, browser runtimes) instead of treating it as a response', async () => {
    const opaqueRedirect = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), body: null };
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: '1' },
      deps: buildDeps({ fetchImpl: (async () => opaqueRedirect) as never }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/redirect/);
    expect(result.error).toMatch(/not followed/);
  });
});

describe('executeOperation — a passthrough caller token and the URL the request goes to', () => {
  const SERVICE_URL = 'http://localhost:9999/v1';
  const callerJwt = jwtWith({ sub: 'u1', resource: SERVICE_URL });

  /** `GET {baseUrl}{pathTemplate}` through a bearer binding that forwards the caller's token. */
  const passthroughEntry = (pathTemplate: string, baseUrl = SERVICE_URL): HiddenOpEntry => {
    const entry = buildEntry({
      httpMethod: 'GET',
      pathTemplate,
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
    });
    entry.service = { id: 'svc', baseUrl };
    entry.authBinding = { kind: 'bearer', vaultRef: 'unused', passthroughCallerToken: true };
    return entry;
  };

  const call = async (entry: HiddenOpEntry, id: string, callerToken = callerJwt) => {
    const sent: { url: string; headers?: Headers }[] = [];
    const fetchImpl = jest.fn(makeFetch({ body: {}, capture: (c) => sent.push(c) }));
    const result = await executeOperation({
      entry,
      bundleId: 'acme',
      input: { id },
      callerToken,
      deps: buildDeps({ resolver: new MemoryCredentialResolver({}), fetchImpl: fetchImpl as never }),
    });
    return { result, sent, fetchImpl };
  };

  it.each([
    ['acct_1', 'http://localhost:9999/v1/acct_1/me'],
    ['a/b', 'http://localhost:9999/v1/a%2Fb/me'],
    ['inv...1', 'http://localhost:9999/v1/inv...1/me'],
  ])('forwards the token for an id of %j', async (id, url) => {
    const { result, sent } = await call(passthroughEntry('/{id}/me'), id);

    expect(result.ok).toBe(true);
    expect(sent).toEqual([expect.objectContaining({ url })]);
    expect(sent[0]?.headers?.get('Authorization')).toBe(`Bearer ${callerJwt}`);
  });

  it('sends nothing when an id of ".." would take the request above the API the token was issued for', async () => {
    // `/v1/../me` is `/me` once the URL is parsed, so the request builder refuses it before the token is checked.
    const { result, fetchImpl } = await call(passthroughEntry('/{id}/me'), '..');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "request build failed: Path parameter 'id' of operation 'createInvoice' cannot be '.' or '..'",
    );
  });

  it.each([
    ['an encoded slash', '../..'],
    ['an encoded backslash', '..\\..'],
    ['double encoding', '%2e%2e'],
    ['a path parameter', '..;'],
  ])('sends nothing when the id hides a ".." segment behind %s', async (_case, id) => {
    const { result, fetchImpl } = await call(passthroughEntry('/{id}/me'), id);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(
      /^auth resolution failed: passthrough caller token refused: the request path .* has a "\.\." segment once percent-decoded/,
    );
  });

  it('sends nothing when a "%2e%2e" template segment resolves above the API', async () => {
    const { result, fetchImpl } = await call(passthroughEntry('/%2e%2e/admin/{id}'), 'x');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.error).toMatch(/the caller token was not issued for http:\/\/localhost:9999\/admin\/x /);
  });

  it('sends nothing when the request leaves the origin the token was issued for', async () => {
    // A template without a leading `/` (which the bundle schema refuses) lets a path parameter
    // extend the host; the token names `http://localhost`, so only the final URL check can stop it.
    const { result, fetchImpl } = await call(
      passthroughEntry('{id}/me', 'http://localhost'),
      '.evil.example',
      jwtWith({ sub: 'u1', resource: 'http://localhost' }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.error).toMatch(/the caller token was not issued for http:\/\/localhost\.evil\.example\/me /);
  });
});

describe('executeOperation — IPv6-literal service hosts (GHSA-4r57-gvgj-5crm)', () => {
  it.each([
    ['https://[::ffff:169.254.169.254]', true],
    ['https://[::ffff:169.254.169.254]', false],
    ['https://[::ffff:0:a9fe:a9fe]', true],
    ['https://[64:ff9b::a9fe:a9fe]', true],
    ['https://[2002:a9fe:a9fe::]', true],
    ['https://[::ffff:10.0.0.5]', false],
  ])(
    'never calls fetch for a bundle service at %s (allowPrivateNetworks=%s)',
    async (baseUrl, allowPrivateNetworks) => {
      const entry = buildEntry();
      entry.service = { id: 'svc', baseUrl };
      const fetchImpl = jest.fn();
      const result = await executeOperation({
        entry,
        bundleId: 'acme',
        input: { id: '1' },
        deps: buildDeps({
          outbound: baseOutbound({ allowPrivateNetworks }),
          allowedHosts: new Set([new URL(baseUrl).hostname.toLowerCase()]),
          fetchImpl: fetchImpl as never,
        }),
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ssrf check rejected request/);
    },
  );
});

describe('executeOperation outbound.egressProxy (#767)', () => {
  const proxiedRequests: Array<{ url: string; proxyUrl: string }> = [];

  beforeAll(() => {
    jest.doMock('undici', () => {
      class ProxyAgent {
        constructor(readonly proxyUrl: string) {}
      }
      return {
        ProxyAgent,
        fetch: async (url: string, init: { dispatcher: ProxyAgent }) => {
          proxiedRequests.push({ url, proxyUrl: init.dispatcher.proxyUrl });
          return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
      };
    });
  });

  afterAll(() => {
    jest.dontMock('undici');
  });

  it('sends the request through the configured proxy', async () => {
    const result = await executeOperation({
      entry: buildEntry(),
      bundleId: 'acme',
      input: { id: 'inv_1', amount: 5 },
      deps: buildDeps({ outbound: baseOutbound({ egressProxy: 'http://proxy.internal:3128' }), fetchImpl: undefined }),
    });

    expect(result.ok).toBe(true);
    expect(proxiedRequests).toEqual([
      { url: 'http://localhost:9999/v1/invoices/inv_1', proxyUrl: 'http://proxy.internal:3128' },
    ]);
  });
});
