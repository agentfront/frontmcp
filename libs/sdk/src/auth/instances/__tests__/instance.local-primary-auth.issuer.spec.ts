/**
 * LocalPrimaryAuth.issuerFor — the issuer (`iss`) a token names and must name.
 *
 * The token endpoint signs with it and every verifier checks it, so the two
 * derive the issuer the same way: a configured issuer wins; a pinned
 * FRONTMCP_PUBLIC_URL comes next; FRONTMCP_PUBLIC_HOST or `expectedAudience`
 * keep the boot-time issuer; a request through a Web fetch handler (which has
 * no listener address) gets its own origin; the Node server keeps the
 * boot-time issuer.
 */
import 'reflect-metadata';

import { ServerRequestTokens, type ServerRequest } from '../../../common';
import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function createProviders() {
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
    metadata: { http: { port: 3001 } },
    registryFlows: jest.fn().mockResolvedValue(undefined),
  };
  return {
    getActiveScope: () => activeScope,
    injectProvider: jest.fn(),
    addDynamicProviders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

const scope = { fullPath: '/mcp', entryPath: '/mcp', routeBase: '' } as never;

async function makeAuth(options: Record<string, unknown>): Promise<LocalPrimaryAuth> {
  const auth = new LocalPrimaryAuth(scope, createProviders(), options as never);
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

const ENV_KEYS = ['FRONTMCP_PUBLIC_URL', 'FRONTMCP_PUBLIC_HOST'];
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

  it("is a Web request's own origin plus the scope path", async () => {
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('https://desk.example.com/mcp');
  });

  it('is the boot-time issuer for a request the Node server hands in', async () => {
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe('http://localhost:3001/mcp');
  });

  it.each([
    ['local.issuer', { mode: 'local', local: { issuer: 'https://auth.example.com' } }, 'https://auth.example.com'],
    ['a public-mode issuer', { mode: 'public', issuer: 'https://anon.example.com' }, 'https://anon.example.com'],
  ])('is the configured issuer (%s) for every request', async (_label, options, expected) => {
    const auth = await makeAuth(options);

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe(expected);
    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe(expected);
  });

  it('is FRONTMCP_PUBLIC_URL plus the scope path when it is pinned', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com/';
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('https://mcp.example.com/mcp');
    expect(auth.issuerFor(nodeRequest('desk.example.com'))).toBe('https://mcp.example.com/mcp');
  });

  it('keeps the boot-time issuer with FRONTMCP_PUBLIC_HOST', async () => {
    process.env['FRONTMCP_PUBLIC_HOST'] = 'mcp.example.com';
    const auth = await makeAuth({ mode: 'local' });

    expect(auth.issuerFor(webRequest('https://desk.example.com/mcp'))).toBe('http://mcp.example.com:3001/mcp');
  });

  it('keeps the boot-time issuer with expectedAudience, so a token serves at every listed address', async () => {
    const auth = await makeAuth({ mode: 'local', expectedAudience: ['https://a.example.com/mcp'] });

    expect(auth.issuerFor(webRequest('https://b.example.com/mcp'))).toBe('http://localhost:3001/mcp');
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
