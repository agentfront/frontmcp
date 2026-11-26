/**
 * `@HttpRoute({ auth: 'bearer', authorities })` (#1362): a route admits the callers the MCP endpoint's auth admits,
 * gives them to `handle()` as `this.auth`, and checks the route's `authorities` the way a tool's are checked, with
 * the body's fields and the path's parameters as input. Both adapters run it.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type * as net from 'node:net';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, frontMcpMetadataSchema, HttpRoute, LogLevel, type FrontMcpConfigInput } from '../../common';
import { HttpRouteContext } from '../../common/interfaces/http-route.interface';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { resourceStore } from '../../resource/materialized';

const PROVIDER = 'https://idp.example.com';
const AUDIENCE = 'https://mcp.example.com';

@HttpRoute({ method: 'GET', path: '/api/me', auth: 'bearer' })
class MeRoute extends HttpRouteContext {
  handle() {
    return { sub: this.auth.user.sub, roles: [...this.auth.roles], scopes: this.getAuthInfo().scopes };
  }
}

@HttpRoute({ method: 'GET', path: '/api/tenants/:tenantId/report', auth: 'bearer', authorities: 'matchTenant' })
class TenantReportRoute extends HttpRouteContext {
  handle() {
    return { tenant: this.params['tenantId'] };
  }
}

@HttpRoute({ method: 'POST', path: '/api/notes', auth: 'bearer', authorities: 'matchTenant' })
class AddNoteRoute extends HttpRouteContext {
  handle() {
    return { saved: (this.request.body as { tenantId: string }).tenantId };
  }
}

@HttpRoute({ method: 'POST', path: '/api/tenants/:tenantId/notes', auth: 'bearer', authorities: 'matchTenant' })
class AddTenantNoteRoute extends HttpRouteContext {
  handle() {
    return { saved: this.params['tenantId'] };
  }
}

@HttpRoute({ method: 'GET', path: '/api/admin', auth: 'bearer', authorities: { roles: { any: ['admin'] } } })
class AdminRoute extends HttpRouteContext {
  handle() {
    return { admin: true };
  }
}

const feedStore = resourceStore({ coalesceMs: 0 });

@HttpRoute({
  method: 'GET',
  path: '/api/feed',
  auth: 'bearer',
  sse: { store: feedStore, topics: ['feed'], coalesceMs: 0, heartbeatMs: 50 },
})
class FeedRoute extends HttpRouteContext {
  handle() {
    return { sub: this.auth.user.sub };
  }
}

@HttpRoute({ method: 'GET', path: '/open', auth: 'public' })
class OpenRoute extends HttpRouteContext {
  handle() {
    return { anonymous: this.auth.isAnonymous };
  }
}

@App({
  id: 'api',
  name: 'api',
  routes: [MeRoute, TenantReportRoute, AddNoteRoute, AddTenantNoteRoute, AdminRoute, FeedRoute, OpenRoute],
})
class ApiApp {}

interface Harness {
  instance: FrontMcpInstance;
  send(path: string, init?: RequestInit): Promise<Response>;
}

async function startExpress(config: FrontMcpConfigInput): Promise<Harness> {
  const opened: http.Server[] = [];
  const realCreateServer = http.createServer.bind(http);
  const spy = jest.spyOn(http, 'createServer').mockImplementation(((...args: never[]) => {
    const created = (realCreateServer as (...a: never[]) => http.Server)(...args);
    opened.push(created);
    return created;
  }) as never);
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse({ ...config, http: { port: 0 } }));
    await instance.ready;
    await instance.start();
    const { port } = opened[0].address() as net.AddressInfo;
    return { instance, send: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init) };
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
}

async function startWebFetch(config: FrontMcpConfigInput): Promise<Harness> {
  const { handler, instance } = await createTestFetchServer(config);
  return { instance, send: (path, init) => handler(new Request(`http://localhost${path}`, init)) };
}

describe.each([
  ['express', startExpress],
  ['web-fetch', startWebFetch],
])("@HttpRoute({ auth: 'bearer' }) on the %s adapter (#1362)", (_adapter, start) => {
  let harness: Harness;
  let privateKey: CryptoKey;

  function mint(
    claims: Record<string, unknown>,
    audience = AUDIENCE,
    expiresAt: number | string = '1h',
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'idp-kid' })
      .setIssuer(PROVIDER)
      .setAudience(audience)
      .setExpirationTime(expiresAt)
      .sign(privateKey);
  }

  async function call(path: string, claims: Record<string, unknown>, init: RequestInit = {}): Promise<Response> {
    const token = await mint(claims);
    return harness.send(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  }

  function postJson(body: unknown): RequestInit {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey as CryptoKey;
    const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'idp-kid', alg: 'RS256', use: 'sig' } as JWK;
    harness = await start({
      info: { name: 'bearer-routes', version: '1.0.0' },
      apps: [ApiApp],
      logging: { level: LogLevel.Off },
      auth: {
        mode: 'transparent',
        provider: PROVIDER,
        expectedAudience: AUDIENCE,
        providerConfig: { id: 'idp', jwks: { keys: [publicJwk] } },
      },
      authorities: {
        claimsMapping: { roles: 'roles', tenantId: 'tenantId' },
        profiles: {
          matchTenant: {
            attributes: { conditions: [{ path: 'claims.tenantId', op: 'eq', value: { fromInput: 'tenantId' } }] },
          },
        },
      },
    } as FrontMcpConfigInput);
  });

  afterAll(async () => {
    await harness.instance.shutdown();
  }, 15_000);

  it('refuses a request without a token with 401 and the challenge of the MCP endpoint', async () => {
    const response = await harness.send('/api/me');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('refuses a token the server does not accept', async () => {
    const forAnotherService = await mint({ sub: 'user-1' }, 'https://other.example.com');

    const response = await harness.send('/api/me', { headers: { Authorization: `Bearer ${forAnotherService}` } });

    expect(response.status).toBe(401);
  });

  it('gives handle() the verified caller as this.auth', async () => {
    const response = await call('/api/me', { sub: 'user-1', roles: ['editor'], scope: 'notes:read' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: 'user-1', roles: ['editor'], scopes: ['notes:read'] });
  });

  it('serves a caller its authorities admit, reading the resource id from the path', async () => {
    const response = await call('/api/tenants/acme/report', { sub: 'user-1', tenantId: 'acme' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenant: 'acme' });
  });

  it('refuses a caller its authorities deny with 403, before handle() runs', async () => {
    const response = await call('/api/tenants/acme/report', { sub: 'user-1', tenantId: 'globex' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('checks a policy of its own on the route', async () => {
    expect((await call('/api/admin', { sub: 'user-1', roles: ['admin'] })).status).toBe(200);
    expect((await call('/api/admin', { sub: 'user-1', roles: ['editor'] })).status).toBe(403);
  });

  it('reads the resource id from the body', async () => {
    const allowed = await call('/api/notes', { sub: 'user-1', tenantId: 'acme' }, postJson({ tenantId: 'acme' }));
    const denied = await call('/api/notes', { sub: 'user-1', tenantId: 'acme' }, postJson({ tenantId: 'globex' }));

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ saved: 'acme' });
    expect(denied.status).toBe(403);
  });

  it("lets the path's parameters win over the body's fields", async () => {
    const response = await call(
      '/api/tenants/globex/notes',
      { sub: 'user-1', tenantId: 'acme' },
      postJson({ tenantId: 'acme' }),
    );

    expect(response.status).toBe(403);
  });

  it('ends a stream when its bearer token expires', async () => {
    const token = await mint({ sub: 'user-1' }, AUDIENCE, Math.floor(Date.now() / 1000) + 2);
    const response = await harness.send('/api/feed', { headers: { Authorization: `Bearer ${token}` } });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let received = '';
    const started = Date.now();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }

    expect(response.status).toBe(200);
    expect(received).toContain('data: {"sub":"user-1"}');
    // Open while the token is valid (it expires 1 to 2 seconds after it is minted), closed once it is not.
    expect(Date.now() - started).toBeGreaterThan(500);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 10_000);

  it('leaves a public route as it was: no token is checked and no caller is given', async () => {
    const response = await harness.send('/open', { headers: { Authorization: 'Bearer not-a-token' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ anonymous: true });
  });
});
