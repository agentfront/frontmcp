/**
 * Responses that carry tokens or client credentials are never cached (RFC 6749 §5.1): every
 * `/oauth/token` and `/oauth/register` response, a guard's rejection and an unexpected failure
 * included, sends `Cache-Control: no-store` and `Pragma: no-cache`. A public server's anonymous
 * tokens live for its `sessionTtl`.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { decodeJwtPayload, disposeServers, postForm } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type FetchHandlerCtx } from '../../transport/web-fetch-handler';
import { LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = 'k'.repeat(64);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await disposeServers(servers);
  if (previousSecret === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = previousSecret;
});

const DENIED_PEER: FetchHandlerCtx = { remoteAddr: { hostname: '203.0.113.9' } };

async function serverWith(auth: AuthConfig, extra: Partial<FrontMcpConfigInput> = {}): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'desk', version: '1.0.0' },
    apps: [DeskApp],
    auth,
    ...extra,
  });
  servers.push(server);
  return server;
}

function postJson(server: TestFetchServer, path: string, body: unknown, ctx?: FetchHandlerCtx): Promise<Response> {
  return server.handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('pragma')).toBe('no-cache');
}

describe('token-bearing responses are never cached', () => {
  it('sends no-store with an anonymous token in public mode', async () => {
    const server = await serverWith({ mode: 'public' } as AuthConfig);

    const response = await postForm(server.handler, '/oauth/token', { grant_type: 'anonymous', client_id: 'desk' });

    expect(response.status).toBe(200);
    expect(((await response.json()) as Record<string, unknown>)['access_token']).toEqual(expect.any(String));
    expectNoStore(response);
  });

  it("gives a public server's anonymous token the sessionTtl lifetime, an hour by default", async () => {
    const byDefault = await serverWith({ mode: 'public' } as AuthConfig);
    const configured = await serverWith({ mode: 'public', sessionTtl: 600 } as AuthConfig);

    for (const [server, ttl] of [
      [byDefault, 3600],
      [configured, 600],
    ] as const) {
      const response = await postForm(server.handler, '/oauth/token', { grant_type: 'anonymous', client_id: 'desk' });
      const body = (await response.json()) as { access_token: string; expires_in: number };
      const claims = decodeJwtPayload(body.access_token);

      expect(body.expires_in).toBe(ttl);
      expect(Number(claims['exp']) - Number(claims['iat'])).toBe(ttl);
    }
  });

  it('sends no-store with a token endpoint error', async () => {
    const server = await serverWith({ mode: 'local' } as AuthConfig);

    const response = await postForm(server.handler, '/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: 'unknown',
      client_id: 'desk',
    });

    expect(response.status).toBe(400);
    expectNoStore(response);
  });

  it('sends no-store with the client a registration returns', async () => {
    const server = await serverWith({ mode: 'local', dcr: { enabled: true } } as AuthConfig);

    const response = await server.handler(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['http://127.0.0.1:33418/callback'],
          token_endpoint_auth_method: 'client_secret_post',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as Record<string, unknown>)['client_secret']).toEqual(expect.any(String));
    expectNoStore(response);
  });

  it.each(['/oauth/token', '/oauth/register'])('sends no-store when throttle.ipFilter turns %s away', async (path) => {
    const server = await serverWith({ mode: 'local', dcr: { enabled: true } } as AuthConfig, {
      throttle: { enabled: true, ipFilter: { denyList: ['203.0.113.0/24'] } },
    });

    const response = await postJson(server, path, {}, DENIED_PEER);

    expect(response.status).toBe(403);
    expectNoStore(response);
  });

  it('sends no-store when a registration fails unexpectedly', async () => {
    const server = await serverWith({ mode: 'local', dcr: { enabled: true } } as AuthConfig);

    const response = await postJson(server, '/oauth/register', { redirect_uris: 'not-a-list' });

    expect(response.status).toBe(500);
    expectNoStore(response);
  });

  it('sends no-store when a token request fails unexpectedly', async () => {
    const server = await serverWith({ mode: 'local' } as AuthConfig);
    jest.spyOn(LocalPrimaryAuth.prototype, 'refreshAccessToken').mockRejectedValueOnce(new Error('store unavailable'));

    const response = await postForm(server.handler, '/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: 'any',
      client_id: 'desk',
    });

    expect(response.status).toBe(500);
    expectNoStore(response);
  });
});
