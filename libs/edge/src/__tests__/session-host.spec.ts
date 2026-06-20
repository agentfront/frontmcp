/**
 * Unit tests for the Cloudflare Durable Object session host.
 *
 * The real `http:request` flow + persistent transport are exercised by the
 * SDK's own suites; here we mock the SDK seams (`buildPersistentWebStandardMcp`,
 * `runHttpRequestFlowWeb`) and `randomUUID` so we can verify the edge-specific
 * WIRING in isolation, without spinning up a server:
 *   - the router forwards to the per-session DO addressed by `Mcp-Session-Id`,
 *     mints an id for a fresh session, stamps the bridge header, and falls back
 *     to stateless (undefined) when the binding is absent or for CORS preflight;
 *   - the DO bridges `env`, builds its scope + persistent pair once (memoized),
 *     resets the memo + rethrows on a build failure, and returns a 404 when the
 *     flow declines the request.
 */
let uuidCounter = 0;

jest.mock('@frontmcp/utils', () => ({
  randomUUID: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const buildPersistentWebStandardMcp = jest.fn();
const runHttpRequestFlowWeb = jest.fn();

jest.mock('@frontmcp/sdk', () => ({
  buildPersistentWebStandardMcp: (...args: unknown[]) => buildPersistentWebStandardMcp(...args),
  runHttpRequestFlowWeb: (...args: unknown[]) => runHttpRequestFlowWeb(...args),
}));

import { createEdgeSessionDurableObject, createEdgeSessionRouter } from '../session-host';

const SESSION_ID_HEADER = 'x-frontmcp-session-id';

beforeEach(() => {
  uuidCounter = 0;
  buildPersistentWebStandardMcp.mockReset();
  runHttpRequestFlowWeb.mockReset();
});

interface StubFetch {
  fetch: jest.Mock<Promise<Response>, [Request]>;
}

function fakeNamespace(): {
  binding: { idFromName: jest.Mock; get: jest.Mock };
  lastStub?: StubFetch;
  lastRequest?: Request;
  idFromNameCalls: string[];
} {
  const ctx: {
    binding: { idFromName: jest.Mock; get: jest.Mock };
    lastStub?: StubFetch;
    lastRequest?: Request;
    idFromNameCalls: string[];
  } = {
    idFromNameCalls: [],
    binding: {
      idFromName: jest.fn((name: string) => {
        ctx.idFromNameCalls.push(name);
        return { __id: name };
      }),
      get: jest.fn(() => {
        const stub: StubFetch = {
          fetch: jest.fn(async (req: Request) => {
            ctx.lastRequest = req;
            return new Response('ok', { status: 200 });
          }),
        };
        ctx.lastStub = stub;
        return stub;
      }),
    },
  };
  return ctx;
}

describe('createEdgeSessionRouter', () => {
  it('forwards to the DO, minting an id for a fresh session and stamping the bridge header', async () => {
    const router = createEdgeSessionRouter('FRONTMCP_SESSIONS');
    const ns = fakeNamespace();
    const request = new Request('https://w.example.com/mcp', { method: 'POST' });

    const res = await router(request, { FRONTMCP_SESSIONS: ns.binding });

    expect(res).toBeInstanceOf(Response);
    expect(res?.status).toBe(200);
    // No incoming Mcp-Session-Id → mint one via randomUUID.
    expect(ns.idFromNameCalls).toEqual(['uuid-1']);
    expect(ns.lastRequest?.headers.get(SESSION_ID_HEADER)).toBe('uuid-1');
  });

  it('reuses an existing Mcp-Session-Id to address the same DO', async () => {
    const router = createEdgeSessionRouter('FRONTMCP_SESSIONS');
    const ns = fakeNamespace();
    const request = new Request('https://w.example.com/mcp', {
      method: 'POST',
      headers: { 'mcp-session-id': 'sess-abc' },
    });

    await router(request, { FRONTMCP_SESSIONS: ns.binding });

    expect(ns.idFromNameCalls).toEqual(['sess-abc']);
    expect(ns.lastRequest?.headers.get(SESSION_ID_HEADER)).toBe('sess-abc');
  });

  it('falls back to stateless (undefined) when the binding is absent', async () => {
    const router = createEdgeSessionRouter('FRONTMCP_SESSIONS');
    const request = new Request('https://w.example.com/mcp', { method: 'POST' });

    expect(await router(request, {})).toBeUndefined();
    expect(await router(request, undefined)).toBeUndefined();
  });

  it('falls back to stateless when the binding is not a DurableObjectNamespace shape', async () => {
    const router = createEdgeSessionRouter('FRONTMCP_SESSIONS');
    const request = new Request('https://w.example.com/mcp', { method: 'POST' });

    // Present but missing idFromName/get.
    expect(await router(request, { FRONTMCP_SESSIONS: {} })).toBeUndefined();
    expect(await router(request, { FRONTMCP_SESSIONS: { idFromName: () => 1 } })).toBeUndefined();
  });

  it('does not route CORS preflight (OPTIONS) — leaves it to the adapter', async () => {
    const router = createEdgeSessionRouter('FRONTMCP_SESSIONS');
    const ns = fakeNamespace();
    const request = new Request('https://w.example.com/mcp', { method: 'OPTIONS' });

    expect(await router(request, { FRONTMCP_SESSIONS: ns.binding })).toBeUndefined();
    expect(ns.binding.get).not.toHaveBeenCalled();
  });
});

describe('createEdgeSessionDurableObject', () => {
  function makeScope(): Record<string, unknown> {
    return { __scope: true };
  }

  it('bridges env, builds scope + persistent pair once, and runs the flow', async () => {
    const scope = makeScope();
    const buildScope = jest.fn(async () => scope);
    const bridgeEnv = jest.fn();
    buildPersistentWebStandardMcp.mockResolvedValue({ __pair: true });
    runHttpRequestFlowWeb.mockResolvedValue(new Response('flow-ok', { status: 200 }));

    const DO = createEdgeSessionDurableObject(buildScope, bridgeEnv);
    const env = { MCP_SESSION_SECRET: 's' };
    const instance = new DO({ __state: true }, env);

    const req1 = new Request('https://w/mcp', { headers: { [SESSION_ID_HEADER]: 'sess-1' } });
    const res1 = await instance.fetch(req1);
    expect(res1.status).toBe(200);
    expect(await res1.text()).toBe('flow-ok');

    expect(bridgeEnv).toHaveBeenCalledWith(env);
    expect(buildScope).toHaveBeenCalledTimes(1);
    expect(buildScope).toHaveBeenCalledWith(env);
    expect(buildPersistentWebStandardMcp).toHaveBeenCalledWith(scope, { sessionId: 'sess-1' });
    expect(runHttpRequestFlowWeb).toHaveBeenCalledWith(scope, req1, { persistent: { __pair: true } });

    // Second request reuses the memoized scope + pair (built once).
    const req2 = new Request('https://w/mcp', { headers: { [SESSION_ID_HEADER]: 'sess-1' } });
    await instance.fetch(req2);
    expect(buildScope).toHaveBeenCalledTimes(1);
    expect(buildPersistentWebStandardMcp).toHaveBeenCalledTimes(1);
    expect(runHttpRequestFlowWeb).toHaveBeenCalledTimes(2);
  });

  it('derives the session id from mcp-session-id, then mints one when neither header is present', async () => {
    const buildScope = jest.fn(async () => makeScope());
    buildPersistentWebStandardMcp.mockResolvedValue({ __pair: true });
    runHttpRequestFlowWeb.mockResolvedValue(new Response('ok'));

    const DO = createEdgeSessionDurableObject(buildScope, jest.fn());

    // mcp-session-id fallback (no bridge header).
    const a = new DO({}, {});
    await a.fetch(new Request('https://w/mcp', { headers: { 'mcp-session-id': 'from-mcp' } }));
    expect(buildPersistentWebStandardMcp).toHaveBeenLastCalledWith(expect.anything(), { sessionId: 'from-mcp' });

    // No id headers at all → randomUUID.
    const b = new DO({}, {});
    await b.fetch(new Request('https://w/mcp'));
    expect(buildPersistentWebStandardMcp).toHaveBeenLastCalledWith(expect.anything(), { sessionId: 'uuid-1' });
  });

  it('returns a 404 JSON response when the flow declines (undefined)', async () => {
    const buildScope = jest.fn(async () => makeScope());
    buildPersistentWebStandardMcp.mockResolvedValue({ __pair: true });
    runHttpRequestFlowWeb.mockResolvedValue(undefined);

    const DO = createEdgeSessionDurableObject(buildScope, jest.fn());
    const instance = new DO({}, {});

    const res = await instance.fetch(new Request('https://w/mcp', { headers: { [SESSION_ID_HEADER]: 's' } }));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });

  it('resets the memoized scope and rethrows when buildScope fails, retrying on the next request', async () => {
    const boom = new Error('scope build failed');
    const buildScope = jest
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(makeScope());
    buildPersistentWebStandardMcp.mockResolvedValue({ __pair: true });
    runHttpRequestFlowWeb.mockResolvedValue(new Response('ok', { status: 200 }));

    const DO = createEdgeSessionDurableObject(buildScope, jest.fn());
    const instance = new DO({}, {});

    await expect(instance.fetch(new Request('https://w/mcp', { headers: { [SESSION_ID_HEADER]: 's' } }))).rejects.toBe(
      boom,
    );
    expect(boom).toBeInstanceOf(Error);

    // The memo was cleared → the next request retries buildScope and succeeds.
    const res = await instance.fetch(new Request('https://w/mcp', { headers: { [SESSION_ID_HEADER]: 's' } }));
    expect(res.status).toBe(200);
    expect(buildScope).toHaveBeenCalledTimes(2);
  });
});
