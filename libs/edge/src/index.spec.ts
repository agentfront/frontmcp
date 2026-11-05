/**
 * Unit/integration test for `createEdgeMcp` — drives the returned Worker
 * module with real Web `Request`/`Response` objects (Node 18+ globals), the
 * same contract a Cloudflare Worker uses. Proves the no-decorator/no-build
 * config path serves MCP end-to-end. The `demo-e2e-cloudflare` app proves it
 * additionally boots inside real workerd.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { App, Tool, ToolContext, z } from '@frontmcp/sdk';

import { createEdgeMcp } from './index';

const echoInput = { message: z.string() };

@Tool({ name: 'echo', description: 'Echo back the input message', inputSchema: echoInput })
class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { content: [{ type: 'text' as const, text: `Echo: ${input.message}` }] };
  }
}

@App({ id: 'worker-pkg-app', name: 'worker-pkg-app', tools: [EchoTool] })
class WorkerApp {}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

/** Read an MCP JSON-RPC response, handling both buffered JSON and the SSE stream the worker emits by default. */
async function readMcp<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) throw new Error(`No SSE data frame: ${text}`);
    return JSON.parse(dataLine.slice('data:'.length).trim()) as T;
  }
  return JSON.parse(text) as T;
}

describe('createEdgeMcp', () => {
  const worker = createEdgeMcp({
    info: { name: 'worker-pkg-test', version: '1.0.0' },
    apps: [WorkerApp],
    tasks: { enabled: false },
    // Config-driven endpoint path: serve MCP at /mcp (default is the worker root `/`).
    http: { entryPath: '/mcp' },
  });

  const mcp = (body: unknown): Promise<Response> =>
    worker.fetch(
      new Request('https://worker.example.com/mcp', {
        method: 'POST',
        headers: MCP_HEADERS,
        body: JSON.stringify(body),
      }),
    );

  it('returns a Worker module synchronously (no eager build)', () => {
    const w = createEdgeMcp({ info: { name: 'lazy', version: '1.0.0' }, apps: [WorkerApp], tasks: { enabled: false } });
    expect(typeof w.fetch).toBe('function');
  });

  it('builds lazily and serves an MCP initialize', async () => {
    const res = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1.0.0' } },
    });
    expect(res.status).toBe(200);
    const json = await readMcp<{ result?: { serverInfo?: { name?: string } } }>(res);
    expect(json.result?.serverInfo?.name).toBe('worker-pkg-test');
  });

  it('lists tools and executes a tool call', async () => {
    const list = await readMcp<{ result?: { tools?: Array<{ name: string }> } }>(
      await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );
    expect((list.result?.tools ?? []).map((t) => t.name)).toContain('echo');

    const call = await readMcp<{ result?: { content?: Array<{ text?: string }> } }>(
      await mcp({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'hi' } },
      }),
    );
    expect(call.result?.content?.[0]?.text).toBe('Echo: hi');
  });

  it('serves liveness via the underlying web-fetch handler', async () => {
    const res = await worker.fetch(new Request('https://worker.example.com/healthz'));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  describe('client IP from the second fetch argument (GHSA-p3qf-fcwm-35x4)', () => {
    const discovery = () => new Request('https://worker.example.com/.well-known/oauth-protected-resource');
    const createFiltered = (ipFilter: {
      allowList?: string[];
      denyList?: string[];
      defaultAction?: 'allow' | 'deny';
    }) =>
      createEdgeMcp({
        info: { name: 'worker-ip-filter', version: '1.0.0' },
        apps: [WorkerApp],
        tasks: { enabled: false },
        throttle: { enabled: true, ipFilter },
      });

    it.each(['Deno', 'Bun'])('reads it on %s', async (runtimeGlobal) => {
      Object.defineProperty(globalThis, runtimeGlobal, { value: {}, configurable: true });
      try {
        const filtered = createFiltered({ denyList: ['203.0.113.0/24'] });

        const denoDenied = await filtered.fetch(discovery(), { remoteAddr: { hostname: '203.0.113.9' } });
        const bunDenied = await filtered.fetch(discovery(), { requestIP: () => ({ address: '203.0.113.9' }) });
        const denoAllowed = await filtered.fetch(discovery(), { remoteAddr: { hostname: '198.51.100.7' } });

        expect([denoDenied.status, bunDenied.status, denoAllowed.status]).toEqual([403, 403, 200]);
      } finally {
        Reflect.deleteProperty(globalThis, runtimeGlobal);
      }
    });

    it('does not read a Worker env object as the peer when no ExecutionContext is passed', async () => {
      const filtered = createFiltered({ allowList: ['198.51.100.0/24'], defaultAction: 'deny' });

      const response = await filtered.fetch(discovery(), { remoteAddr: { hostname: '198.51.100.7' } });

      expect(response.status).toBe(403);
    });
  });

  it('serves the MCP Registry domain proof, server card and AI Catalog', async () => {
    const publicKey = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
    const listed = createEdgeMcp({
      info: { name: 'worker-registry', version: '1.0.0' },
      apps: [WorkerApp],
      tasks: { enabled: false },
      http: { entryPath: '/mcp' },
      registry: { name: 'com.example/worker', description: 'A listed worker', publicKey },
    });
    const get = (path: string) => listed.fetch(new Request(`https://worker.example.com${path}`));

    const proof = await get('/.well-known/mcp-registry-auth');
    expect(proof.status).toBe(200);
    expect(await proof.text()).toBe(`v=MCPv1; k=ed25519; p=${publicKey}`);

    const card = await get('/mcp/server-card');
    expect(card.headers.get('content-type')).toBe('application/mcp-server-card+json');
    expect((await card.json()).remotes[0].url).toBe('https://worker.example.com/mcp');

    const catalog = await (await get('/.well-known/ai-catalog.json')).json();
    expect(catalog.entries).toEqual([
      {
        identifier: 'urn:air:example.com:mcp:worker',
        type: 'application/mcp-server-card+json',
        url: 'https://worker.example.com/mcp/server-card',
      },
    ]);
  });

  it('exposes a Cron `scheduled` handler only in managed mode', () => {
    // Plain edge — no auto-update source, so no scheduled entrypoint.
    expect(worker.scheduled).toBeUndefined();

    // Managed edge — `scheduled` is wired for Cron-driven refresh. Constructing
    // it does NOT import the plugin or boot the scope (both are lazy in build()),
    // so this assertion stays a pure unit check.
    const managed = createEdgeMcp({
      info: { name: 'managed', version: '1.0.0' },
      apps: [],
      tasks: { enabled: false },
      managed: {
        endpoint: 'https://cloud.example.dev/v1/bundles/acme',
        authToken: 'tok',
        expectedAudience: 'acme:prod',
        jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
        expectedIssuer: 'https://cloud.example.dev',
      },
    });
    expect(typeof managed.fetch).toBe('function');
    expect(typeof managed.scheduled).toBe('function');
  });

  it.each([
    [true, 401],
    [false, 404],
  ])('with managed.enableWebhook %s, answers a push without a token with %s', async (enableWebhook, status) => {
    const managed = createEdgeMcp({
      info: { name: 'managed', version: '1.0.0' },
      apps: [],
      tasks: { enabled: false },
      managed: {
        endpoint: 'https://cloud.example.dev/v1/bundles/acme',
        authToken: 'tok',
        expectedAudience: 'acme:prod',
        jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
        expectedIssuer: 'https://cloud.example.dev',
        enableWebhook,
      },
    });

    const response = await managed.fetch(
      new Request('https://worker.example.com/__skilled_openapi/push', { method: 'POST', body: '{}' }),
      {},
    );

    expect(response.status).toBe(status);
  });
});

describe('a managed edge Cron run in an isolate that has served no request', () => {
  const ISSUER = 'https://cloud.example.dev';
  const ENDPOINT = `${ISSUER}/v1/bundles/acme`;
  const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
  const AUDIENCE = 'acme:prod';
  const KEY_ID = 'edge-cron';
  /** The version the bundle server publishes; undefined while it is down. */
  let publishedVersion: string | undefined = '1.0.0';
  let pulls = 0;
  let fetchMock: jest.SpyInstance;
  let pullToken: string;

  const billingBundle = (version: string) => ({
    schemaVersion: 1,
    bundleId: 'edge:billing',
    version,
    generatedAt: '2026-11-04T12:00:00.000Z',
    sourceDigest: '0'.repeat(64),
    services: [{ id: 'billing', baseUrl: 'https://billing.example.dev' }],
    authBindings: { none: { kind: 'none' } },
    skills: [
      {
        id: 'invoices',
        name: 'Invoices',
        description: 'Create invoices.',
        instructions: '# Invoices',
        operationIds: [],
      },
    ],
    operations: {},
  });

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'ES256', use: 'sig' }] };
    pullToken = await new SignJWT({ iss: ISSUER, aud: AUDIENCE })
      .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === JWKS_URL) return Response.json(jwks);
      if (url !== ENDPOINT) return new Response('not found', { status: 404 });
      pulls++;
      return publishedVersion ? Response.json(billingBundle(publishedVersion)) : new Response('down', { status: 503 });
    });
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it.each([
    ['whose build starts the bundle sync (the instructions budget check)', {}],
    ['whose build does not start it', { instructionsBudget: false as const }],
  ])(
    'in a server %s, applies the bundle it pulls and keeps it, with one pull; the next run pulls again',
    async (_label, settings) => {
      publishedVersion = '1.0.0';
      pulls = 0;
      const keptVersions: string[] = [];
      let keptBundle: unknown;
      const managed = createEdgeMcp({
        info: { name: 'managed-cron', version: '1.0.0' },
        apps: [],
        tasks: { enabled: false },
        http: { entryPath: '/mcp' },
        ...settings,
        managed: {
          endpoint: ENDPOINT,
          authToken: pullToken,
          expectedAudience: AUDIENCE,
          jwksUrl: JWKS_URL,
          expectedIssuer: ISSUER,
          requireSignature: false,
          cache: {
            read: async () => keptBundle,
            write: async (bundle) => {
              keptBundle = bundle;
              keptVersions.push((bundle as { version: string }).version);
            },
          },
        },
      });
      if (!managed.scheduled) throw new Error('expected a scheduled handler in managed mode');

      await managed.scheduled({}, {});
      const afterFirstRun = { pulls, keptVersions: [...keptVersions] };
      const search = await readMcp<{ result?: { content?: Array<{ text?: string }> } }>(
        await managed.fetch(
          new Request('https://worker.example.com/mcp', {
            method: 'POST',
            headers: MCP_HEADERS,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'search_skill', arguments: { query: 'invoices' } },
            }),
          }),
        ),
      );
      const pullsAfterRequest = pulls;
      publishedVersion = '2.0.0';
      await managed.scheduled({}, {});

      expect(afterFirstRun).toEqual({ pulls: 1, keptVersions: ['1.0.0'] });
      expect(JSON.parse(search.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        skills: [{ skillId: 'invoices', bundleVersion: '1.0.0' }],
      });
      expect(pullsAfterRequest).toBe(1);
      expect(pulls).toBe(2);
      expect(keptVersions).toEqual(['1.0.0', '2.0.0']);
    },
  );

  it('fails a run whose pulled bundle is refused, and one that serves the cached bundle: /readyz says it is stale', async () => {
    let keptBundle: unknown;
    let cacheWrites = 0;
    const managedWorker = () =>
      createEdgeMcp({
        info: { name: 'managed-cron', version: '1.0.0' },
        apps: [],
        tasks: { enabled: false },
        http: { entryPath: '/mcp' },
        health: { readyz: { enabled: true }, includeDetails: true },
        managed: {
          endpoint: ENDPOINT,
          authToken: pullToken,
          expectedAudience: AUDIENCE,
          jwksUrl: JWKS_URL,
          expectedIssuer: ISSUER,
          requireSignature: false,
          cache: {
            read: async () => keptBundle,
            write: async (bundle) => {
              keptBundle = bundle;
              cacheWrites++;
            },
          },
        },
      });
    const run = (worker: ReturnType<typeof managedWorker>) => {
      if (!worker.scheduled) throw new Error('expected a scheduled handler in managed mode');
      return worker.scheduled({}, {});
    };
    const readiness = async (worker: ReturnType<typeof managedWorker>) =>
      (await worker.fetch(new Request('https://worker.example.com/readyz'))).json();
    const worker = managedWorker();
    publishedVersion = '2.0.0';
    await run(worker);

    publishedVersion = '1.0.0';
    const refusedRun = run(worker);
    await expect(refusedRun).rejects.toThrow(
      '[frontmcp/edge] Cron refresh: bundle edge:billing@1.0.0 was not applied: older than the served bundle edge:billing@2.0.0',
    );
    const afterRefusal = await readiness(worker);
    const writesBeforeRestarts = cacheWrites;
    publishedVersion = undefined;
    const isolateStartedDuringOutage = managedWorker();
    const fallbackRun = run(isolateStartedDuringOutage);
    await expect(fallbackRun).rejects.toThrow(
      '[frontmcp/edge] Cron refresh: the bundle pull failed, so the cached bundle serves: pull responded 503',
    );
    const afterFallback = await readiness(isolateStartedDuringOutage);
    publishedVersion = '1.0.0';
    const isolateStartedOnOlderBundle = managedWorker();
    await expect(run(isolateStartedOnOlderBundle)).rejects.toThrow(
      '[frontmcp/edge] Cron refresh: bundle edge:billing@1.0.0 was not applied, so the cached bundle serves: older than the cached bundle edge:billing@2.0.0',
    );
    const afterOlderPull = await readiness(isolateStartedOnOlderBundle);

    expect(afterRefusal).toMatchObject({
      status: 'ready',
      probes: {
        'skilled-openapi': {
          status: 'degraded',
          details: {
            state: 'stale',
            bundleId: 'edge:billing',
            bundleVersion: '2.0.0',
            lastSync: { status: 'refused', bundleVersion: '1.0.0', reason: expect.stringContaining('older than') },
          },
        },
      },
    });
    expect(afterFallback).toMatchObject({
      status: 'ready',
      probes: {
        'skilled-openapi': {
          status: 'degraded',
          details: {
            state: 'stale',
            bundleVersion: '2.0.0',
            lastSync: { status: 'failed', reason: 'pull responded 503', cacheFallback: true },
          },
        },
      },
    });
    expect(afterOlderPull).toMatchObject({
      status: 'ready',
      probes: {
        'skilled-openapi': {
          status: 'degraded',
          details: {
            state: 'stale',
            bundleVersion: '2.0.0',
            lastSync: { status: 'refused', bundleVersion: '1.0.0', cacheFallback: true },
          },
        },
      },
    });
    expect(cacheWrites).toBe(writesBeforeRestarts);
  });
});

/**
 * The server is built on its first request, but a config whose entries ask for protection nothing
 * gives them (an `approval` or `featureFlag` field no plugin enforces, `authorities` without the
 * `authorities` option) is refused where the module creates it, as `createDirect()` refuses it.
 */
describe('createEdgeMcp startup checks', () => {
  // The plugin field is declared by the approval plugin's type augmentation, which this test does not load.
  const APPROVAL: Record<string, unknown> = { approval: true };

  @Tool({ name: 'refund_invoice', inputSchema: {}, ...APPROVAL })
  class RefundInvoiceTool extends ToolContext {
    async execute() {
      return { refunded: true };
    }
  }

  @Tool({ name: 'lookup_order', inputSchema: {}, authorities: 'admin' })
  class LookupOrderTool extends ToolContext {
    async execute() {
      return { order: 'o-1' };
    }
  }

  @App({ id: 'billing', name: 'billing', tools: [RefundInvoiceTool] })
  class BillingApp {}

  @App({ id: 'orders', name: 'orders', tools: [LookupOrderTool] })
  class OrdersApp {}

  const edge = (apps: unknown[]) =>
    createEdgeMcp({ info: { name: 'edge-startup', version: '1.0.0' }, apps: apps as never, tasks: { enabled: false } });

  it('refuses an approval field no plugin enforces', () => {
    expect(() => edge([BillingApp])).toThrow(`Tool "refund_invoice" declares 'approval'`);
  });

  it('refuses authorities without the authorities option', () => {
    expect(() => edge([OrdersApp])).toThrow(/Authorities configuration required: Tool "lookup_order"/);
  });
});
