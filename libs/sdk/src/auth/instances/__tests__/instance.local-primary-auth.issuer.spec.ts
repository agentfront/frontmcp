/**
 * LocalPrimaryAuth.issuerFor — the issuer this server names for a request: in
 * discovery, on authorization responses and as the `iss` of its tokens, which
 * every verifier then requires (#269, #629). One order for every entry point,
 * the Node server and a Web fetch handler alike: a configured issuer, then a
 * pinned FRONTMCP_PUBLIC_URL, then the FRONTMCP_PUBLIC_HOST boot-time issuer,
 * then the request's own origin (the boot-time issuer without a request).
 */
import 'reflect-metadata';

import { ServerRequestTokens, type ServerRequest } from '../../../common';
import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function createProviders(metadata: Record<string, unknown> = { http: { port: 3001 } }) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  const activeScope = {
    logger,
    metadata,
    registryFlows: jest.fn().mockResolvedValue(undefined),
  };
  return {
    getActiveScope: () => activeScope,
    injectProvider: jest.fn(),
    addDynamicProviders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

const scope = { fullPath: '/mcp', entryPath: '/mcp', routeBase: '' } as never;

async function makeAuth(
  options: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Promise<LocalPrimaryAuth> {
  const auth = new LocalPrimaryAuth(scope, createProviders(metadata), options as never);
  await auth.ready;
  return auth;
}

/** A request as the Web fetch handler builds it (it carries the native `Request`). */
function webRequest(url: string): ServerRequest {
  const parsed = new URL(url);
  const request = {
    method: 'POST',
    protocol: parsed.protocol.slice(0, -1),
    path: parsed.pathname,
    url: parsed.pathname,
    headers: { host: parsed.host },
    query: {},
  } as unknown as ServerRequest;
  (request as unknown as Record<PropertyKey, unknown>)[ServerRequestTokens.webRequest] = new Request(url);
  return request;
}

/** A request as the Node server hands it (no native `Request`). */
function nodeRequest(host: string): ServerRequest {
  return { method: 'POST', protocol: 'http', path: '/mcp', url: '/mcp', headers: { host }, query: {} } as never;
}

const ENV_KEYS = ['FRONTMCP_PUBLIC_URL', 'FRONTMCP_PUBLIC_HOST', 'PORT'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('LocalPrimaryAuth.issuerFor', () => {
  it('is the boot-time issuer without a request', async () => {
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor()).toBe('http://localhost:3001/mcp');
  });

  it('uses the port the server listens on when @FrontMcp has no http options (#766)', async () => {
    expect((await makeAuth({ mode: 'local' }, {})).issuerFor()).toBe('http://localhost:3000/mcp');

    process.env['PORT'] = '4123';
    expect((await makeAuth({ mode: 'local' }, {})).issuerFor()).toBe('http://localhost:4123/mcp');
  });

  it("is a Web request's own origin plus the scope path", async () => {
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('https://desk.example.com/mcp');
  });

  it("is a Node request's own origin plus the scope path, as for a Web request (#629)", async () => {
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe('http://desk.example.com/mcp');
  });

  it.each([
    ['local.issuer', { mode: 'local', local: { issuer: 'https://auth.example.com' } }, 'https://auth.example.com'],
    ['a public-mode issuer', { mode: 'public', issuer: 'https://anon.example.com' }, 'https://anon.example.com'],
  ])('is the configured issuer (%s) for every request', async (_label, options, expected) => {
    const auth = await makeAuth(options);

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe(expected);
    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe(expected);
  });

  it('drops a trailing slash from local.issuer, so the provider callback has no double slash', async () => {
    const auth = await makeAuth({
      mode: 'remote',
      provider: 'https://idp.example.com',
      clientId: 'desk',
      providerConfig: { id: 'idp' },
      local: { issuer: 'https://desk.example.com/' },
    });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('https://desk.example.com');
    expect(auth.getProviderConfig('idp')?.callbackUrl).toBe('https://desk.example.com/oauth/provider/idp/callback');
  });

  it('is FRONTMCP_PUBLIC_URL plus the scope path when it is pinned', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com/';
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('https://mcp.example.com/mcp');
    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe('https://mcp.example.com/mcp');
    expect(auth.issuerFor()).toBe('https://mcp.example.com/mcp');
  });

  it('puts FRONTMCP_PUBLIC_URL before FRONTMCP_PUBLIC_HOST (#629)', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com';
    process.env['FRONTMCP_PUBLIC_HOST'] = 'boot.example.com';
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe('https://mcp.example.com/mcp');
  });

  it('keeps the boot-time issuer with FRONTMCP_PUBLIC_HOST, on both entry points', async () => {
    process.env['FRONTMCP_PUBLIC_HOST'] = 'mcp.example.com';
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('http://mcp.example.com:3001/mcp');
    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe('http://mcp.example.com:3001/mcp');
  });

  it('follows the request with expectedAudience, and accepts the issuer of every listed address', async () => {
    const auth = await makeAuth({ mode: 'local', expectedAudience: ['https://a.example.com/mcp'] });
    const atB = webRequest('https://b.example.com/mcp');

    expect(auth.issuerFor(atB)).toBe('https://b.example.com/mcp');
    expect(auth.acceptedIssuersFor(atB)).toEqual(
      expect.arrayContaining(['https://b.example.com/mcp', 'https://a.example.com/mcp', 'http://localhost:3001/mcp']),
    );
  });

  it('accepts only the one issuer when nothing lists other addresses, or something pins it', async () => {
    expect((await makeAuth({ mode: 'local' })).acceptedIssuersFor(nodeRequest('desk.example.com'))).toBe(
      'http://desk.example.com/mcp',
    );
    const configured = await makeAuth({
      mode: 'local',
      local: { issuer: 'https://auth.example.com' },
      expectedAudience: ['https://a.example.com/mcp'],
    });
    expect(configured.acceptedIssuersFor(nodeRequest('desk.example.com'))).toBe('https://auth.example.com');
  });

  it('signs and verifies with the same issuer for a Web request', async () => {
    const auth = await makeAuth({ mode: 'local' });
    const desk = auth.issuerFor(webRequest('https://desk.example.com/mcp'));
    const billing = auth.issuerFor(webRequest('https://billing.example.com/mcp'));
    const token = await auth.signAnonymousJwt({ audience: 'https://desk.example.com/mcp', issuer: desk });

    expect((await auth.verifyGatewayToken(token, desk, undefined, desk)).ok).toBe(true);
    expect((await auth.verifyGatewayToken(token, billing, undefined, billing)).ok).toBe(false);
    expect((await auth.verifyGatewayToken(token, desk)).ok).toBe(false);
  });
});
