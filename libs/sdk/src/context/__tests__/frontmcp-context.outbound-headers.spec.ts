import { FrontMcpContext } from '../frontmcp-context';

describe('FrontMcpContext.fetch outbound headers to a third-party origin', () => {
  const originalFetch = global.fetch;
  const thirdPartyUrl = 'https://third-party.example/v1/forecast';
  const callerToken = 'caller-mcp-access-token';

  let fetchMock: jest.Mock;

  function createCallerContext(): FrontMcpContext {
    const ctx = new FrontMcpContext({
      sessionId: 'outbound-headers-session',
      scopeId: 'outbound-headers-scope',
      metadata: { customHeaders: { 'x-frontmcp-internal-user': 'admin' } },
    });
    ctx.updateAuthInfo({ token: callerToken });
    return ctx;
  }

  function sentHeaders(): Headers {
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    return new Headers(init.headers);
  }

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response('{}'));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not send the caller MCP access token as an Authorization header', async () => {
    await createCallerContext().fetch(thirdPartyUrl);

    expect(sentHeaders().get('authorization')).toBeNull();
  });

  it('does not forward client-supplied x-frontmcp-* request headers', async () => {
    await createCallerContext().fetch(thirdPartyUrl);

    const forwardedFrontMcpHeaders: string[] = [];
    sentHeaders().forEach((_value, name) => {
      if (name.startsWith('x-frontmcp-')) forwardedFrontMcpHeaders.push(name);
    });
    expect(forwardedFrontMcpHeaders).toEqual([]);
  });
});
