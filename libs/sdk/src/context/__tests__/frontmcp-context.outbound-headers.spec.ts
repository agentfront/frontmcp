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

describe('FrontMcpContext.fetch to an origin in forwardCallerTokenTo', () => {
  const originalFetch = global.fetch;
  const internalUrl = 'https://api.internal.example/v1/me';
  let fetchMock: jest.Mock;

  function contextWithToken(token: string | undefined): FrontMcpContext {
    const ctx = new FrontMcpContext({
      sessionId: 'forwarding-session',
      scopeId: 'forwarding-scope',
      config: { forwardCallerTokenTo: ['https://api.internal.example'] },
    });
    ctx.updateAuthInfo({ token });
    return ctx;
  }

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response('{}'));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function sentAuthorization(): string | null {
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    return new Headers(init.headers).get('authorization');
  }

  it("sends the caller's token", async () => {
    await contextWithToken('caller-token').fetch(internalUrl);

    expect(sentAuthorization()).toBe('Bearer caller-token');
  });

  it('sends no Authorization header for an anonymous caller, whose token is empty', async () => {
    await contextWithToken('').fetch(internalUrl);

    expect(sentAuthorization()).toBeNull();
  });
});
