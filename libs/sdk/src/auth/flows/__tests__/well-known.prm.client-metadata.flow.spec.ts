/**
 * Well-known PRM flow — the sign-in details a transparent server publishes for its clients (#1360).
 *
 * `auth.resourceMetadata` adds `client_id` and `audience` to the protected resource metadata; without it the
 * document carries the RFC 9728 fields only, as before.
 */
import 'reflect-metadata';

import { transparentAuthOptionsSchema } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { createMockHttpRequest, createMockScopeEntry } from '../../../__test-utils__';
import { httpInputSchema, HttpJsonSchema, type FlowMetadata } from '../../../common';
import WellKnownPrmFlow from '../well-known.prm.flow';

const PROVIDER = 'https://idp.example.com/';

function prmMetadata(): FlowMetadata<'well-known.oauth-protected-resource'> {
  return {
    name: 'well-known.oauth-protected-resource',
    plan: { pre: ['parseInput'], execute: ['collectData'] },
    inputSchema: httpInputSchema,
    outputSchema: HttpJsonSchema.extend({ body: z.object({}).passthrough() }),
    access: 'public',
    middleware: { method: 'GET' },
  } as unknown as FlowMetadata<'well-known.oauth-protected-resource'>;
}

async function fetchPrm(
  auth: Record<string, unknown>,
  {
    host = 'mcp.example.com',
    entryPath = '',
    allowedHosts,
  }: { host?: string; entryPath?: string; allowedHosts?: string[] } = {},
): Promise<Record<string, unknown>> {
  const options = { mode: 'transparent', provider: PROVIDER, ...auth };
  const scope = createMockScopeEntry({ auth: options as never });
  (scope as { entryPath: string }).entryPath = entryPath;
  (scope.auth as { options: unknown }).options = options;
  (scope as { getAllSupportedScopes: () => string[] }).getAllSupportedScopes = () => [];
  if (allowedHosts) {
    (scope.metadata as { http: unknown }).http = { port: 3001, security: { dnsRebindingProtection: { allowedHosts } } };
  }
  const input = createMockHttpRequest({
    method: 'GET',
    path: `${entryPath}/.well-known/oauth-protected-resource`,
    headers: { host },
  });
  const flow = new WellKnownPrmFlow(prmMetadata(), input as never, scope, jest.fn(), new Map()) as unknown as {
    parseInput(): Promise<void>;
    collectData(): Promise<void>;
  };
  await flow.parseInput();
  try {
    await flow.collectData();
  } catch (control) {
    return (control as { output: { body: Record<string, unknown> } }).output.body;
  }
  throw new Error('the flow did not respond');
}

describe('Well-known PRM flow — transparent auth.resourceMetadata (#1360)', () => {
  const originalEnv = {
    FRONTMCP_PUBLIC_URL: process.env['FRONTMCP_PUBLIC_URL'],
    FRONTMCP_ALLOWED_HOSTS: process.env['FRONTMCP_ALLOWED_HOSTS'],
    NODE_ENV: process.env['NODE_ENV'],
  };

  beforeEach(() => {
    delete process.env['FRONTMCP_PUBLIC_URL'];
    delete process.env['FRONTMCP_ALLOWED_HOSTS'];
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('publishes neither client_id nor audience without resourceMetadata', async () => {
    const body = await fetchPrm({ clientId: 'lens-cli', expectedAudience: 'https://api.lens.example' });

    expect(body).toEqual({
      resource: 'http://mcp.example.com',
      authorization_servers: [PROVIDER],
      bearer_methods_supported: ['header'],
    });
  });

  it('publishes the client id resourceMetadata.clientId names', async () => {
    const body = await fetchPrm({ clientId: 'server-client', resourceMetadata: { clientId: 'lens-cli' } });

    expect(body['client_id']).toBe('lens-cli');
    expect(body).not.toHaveProperty('audience');
  });

  it('publishes auth.clientId for resourceMetadata.clientId: true', async () => {
    const body = await fetchPrm({ clientId: 'lens-cli', resourceMetadata: { clientId: true } });

    expect(body['client_id']).toBe('lens-cli');
  });

  it('publishes no client_id for resourceMetadata.clientId: true without auth.clientId', async () => {
    const body = await fetchPrm({ resourceMetadata: { clientId: true } });

    expect(body).not.toHaveProperty('client_id');
  });

  it('publishes the audience resourceMetadata.audience names', async () => {
    const body = await fetchPrm({
      expectedAudience: 'https://api.lens.example',
      resourceMetadata: { audience: 'lens-api' },
    });

    expect(body['audience']).toBe('lens-api');
  });

  it.each([
    ['a string', 'https://api.lens.example'],
    ['a list, its first entry', ['https://api.lens.example', 'https://legacy.lens.example']],
  ])('publishes expectedAudience for resourceMetadata.audience: true when it is %s', async (_name, expected) => {
    const body = await fetchPrm({ expectedAudience: expected, resourceMetadata: { audience: true } });

    expect(body['audience']).toBe('https://api.lens.example');
  });

  it('publishes the pinned FRONTMCP_PUBLIC_URL with the entry path, whatever the Host header says', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://lens.example';
    const body = await fetchPrm({ resourceMetadata: { audience: true } }, { host: 'evil.example', entryPath: '/mcp' });

    expect(body['audience']).toBe('https://lens.example/mcp');
  });

  it("publishes the request's address when its host is an allowed host", async () => {
    const body = await fetchPrm({ resourceMetadata: { audience: true } }, { allowedHosts: ['mcp.example.com'] });

    expect(body['audience']).toBe('http://mcp.example.com');
  });

  it("does not publish the address of a request whose host isn't allowed", async () => {
    process.env['NODE_ENV'] = 'production';
    const body = await fetchPrm({ resourceMetadata: { audience: true } }, { host: 'evil.example' });

    expect(body).not.toHaveProperty('audience');
  });

  it('publishes the loopback address in tests when nothing configures the audience', async () => {
    process.env['NODE_ENV'] = 'test';
    const body = await fetchPrm({ resourceMetadata: { audience: true } }, { host: 'localhost:3001' });

    expect(body['audience']).toBe('http://localhost:3001');
  });
});

describe('transparentAuthOptionsSchema — resourceMetadata (#1360)', () => {
  const base = { mode: 'transparent' as const, provider: 'https://idp.example.com' };

  it('accepts true or a value for clientId and audience', () => {
    const parsed = transparentAuthOptionsSchema.parse({
      ...base,
      resourceMetadata: { clientId: true, audience: 'https://api.lens.example' },
    });

    expect(parsed.resourceMetadata).toEqual({ clientId: true, audience: 'https://api.lens.example' });
  });

  it.each([
    ['clientId', false],
    ['clientId', ''],
    ['audience', false],
    ['audience', ''],
  ])('refuses %s: %p', (field, value) => {
    expect(transparentAuthOptionsSchema.safeParse({ ...base, resourceMetadata: { [field]: value } }).success).toBe(
      false,
    );
  });
});
