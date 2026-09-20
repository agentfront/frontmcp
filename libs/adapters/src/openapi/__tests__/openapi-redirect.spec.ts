/**
 * The OpenAPI adapter never follows an upstream redirect (GHSA-qh67-4345-cw2q).
 *
 * `createOpenApiTool`'s execution `fetch` carried no `redirect` option, and the WHATWG
 * default is `follow`. Two consequences:
 *
 *  1. SSRF. Only the operator's `baseUrl` is validated, and only for its scheme. The
 *     destination after a 3xx is chosen by the upstream, so a redirect to `169.254.169.254`
 *     or an RFC1918 host is followed and its body handed back to the tool caller.
 *  2. Credential leak. undici strips `Authorization` and `Cookie` across origins but
 *     forwards custom headers — which is exactly how this adapter injects API keys
 *     (`security.headers`, `additionalHeaders`). The key reaches the redirect target's
 *     origin.
 *
 * Three sibling outbound clients already set `redirect: 'manual'` for this exact reason;
 * this call site was the outlier.
 */
import type { McpOpenAPITool } from 'mcp-from-openapi';

import { createOpenApiTool } from '../openapi.tool';
import { basicOpenApiSpec, createMockLogger } from './fixtures';

jest.mock('mcp-from-openapi', () => ({
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({ headers: {}, query: {}, cookies: {} }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

jest.mock('../openapi.utils', () => ({
  buildRequest: jest.fn((tool, input, security, baseUrl) => ({
    url: `${baseUrl}${tool.metadata.path}`,
    headers: new Map([['x-api-key', 'STATIC_BACKEND_API_KEY']]),
    body: input,
  })),
  applyAdditionalHeaders: jest.fn(),
  parseResponse: jest.fn(async (response: Response) => ({
    success: true,
    status: response.status,
    ok: response.ok,
    data: { body: 'parsed' },
  })),
}));

jest.mock('../openapi.security', () => ({
  resolveToolSecurity: jest.fn().mockResolvedValue({}),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function createMockTool(): McpOpenAPITool {
  return {
    name: 'test_tool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    mapper: [],
    metadata: { method: 'get', path: '/test', servers: [{ url: 'https://api.example.com' }] },
  } as McpOpenAPITool;
}

function createExecutor() {
  const logger = createMockLogger();
  const tool = createOpenApiTool(
    createMockTool(),
    { name: 'test-api', baseUrl: 'https://api.example.com', spec: basicOpenApiSpec, logger },
    logger,
  );
  return tool();
}

function createToolContext() {
  return {
    context: { authInfo: { user: { id: 'user-1' } }, sessionId: 'session-1', traceId: 'trace-1' },
    get: jest.fn(),
    fail: jest.fn(),
    mark: jest.fn(),
  };
}

describe('OpenAPI tool execution — redirects (GHSA-qh67-4345-cw2q)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  it('asks fetch not to follow redirects', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers() });

    await createExecutor()({ id: '123' }, createToolContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1];
    expect(init.redirect).toBe('manual');
  });

  it('refuses a 3xx rather than chasing it with the injected credential', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
    });

    const result: any = await createExecutor()({ id: '123' }, createToolContext());

    // Exactly one request: the redirect target is never contacted.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // And the redirect body is not passed off as a successful API response.
    expect(JSON.stringify(result ?? '')).not.toContain('meta-data');
  });

  it.each([301, 302, 303, 307, 308])('treats %s as a failure, not a result', async (status) => {
    mockFetch.mockResolvedValue({
      ok: false,
      status,
      headers: new Headers({ location: 'https://attacker.test/collect' }),
    });

    const result: any = await createExecutor()({ id: '123' }, createToolContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result ?? '')).toMatch(/redirect/i);
  });

  it('still returns an ordinary 2xx response', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers() });

    const result: any = await createExecutor()({ id: '123' }, createToolContext());

    expect(JSON.stringify(result ?? '')).toContain('parsed');
  });

  it('still surfaces an ordinary 4xx without calling it a redirect', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, headers: new Headers() });

    const result: any = await createExecutor()({ id: '123' }, createToolContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result ?? '')).not.toMatch(/redirect/i);
  });
});
