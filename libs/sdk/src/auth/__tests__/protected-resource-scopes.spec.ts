/**
 * `scopes_supported` in the protected resource metadata (RFC 9728 §2) names
 * the scopes a client can actually be given for this server, in every auth
 * mode (#629). Local and remote mode already advertised `allowedScopes`
 * (#262); public, static and transparent mode listed `openid`, `profile` and
 * `email` whatever the server grants.
 */
import 'reflect-metadata';

import { resourceScopesFor } from '@frontmcp/auth';

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

@Tool({ name: 'repos', inputSchema: {}, authProviders: [{ name: 'github', scopes: ['repo:read'] }] })
class ReposTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'code', name: 'Code', tools: [ReposTool] })
class CodeApp {}

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

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

async function advertised(auth: AuthConfig | undefined, apps: unknown[] = [DeskApp]): Promise<Record<string, unknown>> {
  const server = await createTestFetchServer({
    info: { name: 'scopes-desk', version: '1.0.0' },
    apps: apps as FrontMcpConfigInput['apps'],
    ...(auth ? { auth } : {}),
  });
  servers.push(server);
  const response = await httpGet(server.handler, '/.well-known/oauth-protected-resource', 'desk.example.com');
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe('protected resource metadata scopes_supported by auth mode (#629)', () => {
  it('public mode: the scopes the anonymous grant gives', async () => {
    const body = await advertised({ mode: 'public', anonymousScopes: ['docs:read', 'docs:search'] } as AuthConfig);
    expect(body['scopes_supported']).toEqual(['docs:read', 'docs:search']);
  });

  it('no auth configured: public mode default', async () => {
    const body = await advertised(undefined);
    expect(body['scopes_supported']).toEqual(['anonymous']);
  });

  it('static mode: the scopes the static credential carries', async () => {
    const body = await advertised({ mode: 'static', tokens: ['t'.repeat(32)], scopes: ['reports:read'] } as AuthConfig);
    expect(body['scopes_supported']).toEqual(['reports:read']);
  });

  it('transparent mode: the required scopes, then the scopes asked of the provider', async () => {
    const body = await advertised({
      mode: 'transparent',
      provider: 'https://idp.example.com',
      requiredScopes: ['tickets:read'],
      scopes: ['openid', 'tickets:read'],
    } as AuthConfig);
    expect(body['scopes_supported']).toEqual(['tickets:read', 'openid']);
  });

  it('transparent mode that names no scope: leaves scopes_supported out', async () => {
    const body = await advertised({ mode: 'transparent', provider: 'https://idp.example.com' } as AuthConfig);
    expect(body).not.toHaveProperty('scopes_supported');
  });

  it('keeps advertising the scopes a tool declares on its authProviders, with no OIDC defaults', async () => {
    const body = await advertised({ mode: 'public', anonymousScopes: ['docs:read'] } as AuthConfig, [CodeApp]);
    expect(body['scopes_supported']).toEqual(['docs:read', 'repo:read']);
  });

  it('local mode: allowedScopes, as before', async () => {
    const body = await advertised({ mode: 'local', allowedScopes: ['tickets:read', 'tickets:*'] } as AuthConfig);
    expect(body['scopes_supported']).toEqual(['tickets:read']);
  });
});

describe('resourceScopesFor', () => {
  it('drops globs and duplicates, and reads the fields of the mode it is given', () => {
    expect(resourceScopesFor({ mode: 'remote' })).toEqual(['openid', 'profile', 'email', 'offline_access']);
    expect(resourceScopesFor({ mode: 'public', anonymousScopes: [] })).toEqual([]);
    expect(resourceScopesFor({ mode: 'transparent', requiredScopes: ['a'], scopes: ['a', 'b:*', 'c'] })).toEqual([
      'a',
      'c',
    ]);
    expect(resourceScopesFor({ mode: 'static' })).toEqual(['static']);
    expect(resourceScopesFor(undefined)).toEqual(['anonymous']);
  });
});
