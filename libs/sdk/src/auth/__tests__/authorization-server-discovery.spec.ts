/**
 * Only a server with an authorization server advertises one. A public or static server answers
 * `/.well-known/oauth-authorization-server` with 404 (it used to redirect to a leftover
 * `http://localhost:<port>`) and names no `authorization_servers` in its protected resource metadata.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers, httpGet } from '../../__test-utils__/helpers/oauth-flow.helpers';
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

const HOST = 'desk.example.com';
const servers: TestFetchServer[] = [];
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = 'k'.repeat(64);
});

afterAll(async () => {
  await disposeServers(servers);
  if (previousSecret === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = previousSecret;
});

async function serverWith(auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server;
}

describe('authorization server discovery by auth mode', () => {
  it.each([
    ['public', { mode: 'public' }],
    ['public with an issuer', { mode: 'public', issuer: 'https://login.example.com' }],
    ['static', { mode: 'static', tokens: ['t'.repeat(32)] }],
  ])('%s: no authorization server metadata, and none named in the resource metadata', async (_mode, auth) => {
    const server = await serverWith(auth as AuthConfig);

    const metadata = await httpGet(server.handler, '/.well-known/oauth-authorization-server', HOST);
    const resource = await httpGet(server.handler, '/.well-known/oauth-protected-resource', HOST);

    expect(metadata.status).toBe(404);
    expect(metadata.headers.get('location')).toBeNull();
    expect(resource.status).toBe(200);
    const body = (await resource.json()) as Record<string, unknown>;
    expect(body['resource']).toBe(`http://${HOST}`);
    expect(body).not.toHaveProperty('authorization_servers');
  });

  it("transparent: redirects to the provider's metadata, without doubling a trailing slash", async () => {
    const server = await serverWith({
      mode: 'transparent',
      provider: 'https://idp.example.com/',
      expectedAudience: `http://${HOST}`,
    } as AuthConfig);

    const metadata = await httpGet(server.handler, '/.well-known/oauth-authorization-server', HOST);
    const resource = (await (
      await httpGet(server.handler, '/.well-known/oauth-protected-resource', HOST)
    ).json()) as Record<string, unknown>;

    expect(metadata.status).toBe(302);
    expect(metadata.headers.get('location')).toBe('https://idp.example.com/.well-known/oauth-authorization-server');
    expect(resource['authorization_servers']).toEqual([`http://${HOST}`]);
  });

  it('local: serves its own metadata and names itself in the resource metadata', async () => {
    const server = await serverWith({ mode: 'local' } as AuthConfig);

    const metadata = await httpGet(server.handler, '/.well-known/oauth-authorization-server', HOST);
    const resource = (await (
      await httpGet(server.handler, '/.well-known/oauth-protected-resource', HOST)
    ).json()) as Record<string, unknown>;

    expect(metadata.status).toBe(200);
    expect(((await metadata.json()) as Record<string, unknown>)['issuer']).toBe(`http://${HOST}`);
    expect(resource['authorization_servers']).toEqual([`http://${HOST}`]);
  });
});
