/**
 * `POST /oauth/register` answers client metadata that fails validation as RFC 7591 §3.2.2 says: 400 with
 * `invalid_client_metadata`, or `invalid_redirect_uri` when a redirect URI it lists is refused. It answered
 * 500 `server_misconfigured` (CONFIG_INVALID), as if the server's own configuration were invalid.
 *
 * Driven over the fetch handler: the flow answers by itself, so every host serves the same response.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const REDIRECT_URI = 'http://127.0.0.1:33418/callback';

const servers: TestFetchServer[] = [];

async function register(auth: AuthConfig, metadata: unknown): Promise<Response> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server.handler(
    new Request('http://localhost/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metadata),
    }),
  );
}

afterAll(async () => {
  await disposeServers(servers);
});

describe('POST /oauth/register', () => {
  const registrationOpen = { mode: 'local', dcr: { enabled: true } } as AuthConfig;

  it.each<[string, unknown, string, string]>([
    ['no metadata', {}, 'invalid_client_metadata', 'redirect_uris'],
    ['redirect_uris that is not a list', { redirect_uris: REDIRECT_URI }, 'invalid_client_metadata', 'redirect_uris'],
    ['an empty redirect_uris list', { redirect_uris: [] }, 'invalid_client_metadata', 'redirect_uris'],
    [
      'a redirect URI that is not a URL',
      { redirect_uris: [REDIRECT_URI, 'not a url'] },
      'invalid_redirect_uri',
      'redirect_uris.1',
    ],
    [
      'an unknown token_endpoint_auth_method',
      { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'handshake' },
      'invalid_client_metadata',
      'token_endpoint_auth_method',
    ],
    [
      'grant_types that is not a list',
      { redirect_uris: [REDIRECT_URI], grant_types: 'authorization_code' },
      'invalid_client_metadata',
      'grant_types',
    ],
  ])('answers 400 to %s, naming the field', async (_label, metadata, error, field) => {
    const response = await register(registrationOpen, metadata);

    const body = (await response.json()) as Record<string, string>;
    expect({ status: response.status, error: body['error'] }).toEqual({ status: 400, error });
    expect(body['error_description']).toContain(`${field}: `);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('still registers a client whose metadata is valid', async () => {
    const response = await register(registrationOpen, { redirect_uris: [REDIRECT_URI] });

    expect(response.status).toBe(201);
  });

  it('answers 404 to invalid metadata when registration is disabled', async () => {
    const response = await register({ mode: 'local', dcr: { enabled: false } } as AuthConfig, {});

    expect(response.status).toBe(404);
  });

  it('answers 401 to invalid metadata sent without the initial access token', async () => {
    const response = await register(
      { mode: 'local', dcr: { enabled: true, initialAccessToken: 'registration-token' } } as AuthConfig,
      {},
    );

    expect(response.status).toBe(401);
  });
});
