import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type DirectMcpServer } from '../direct.types';

const upstreamUrl = 'https://upstream.example/v1/profile';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    await this.fetch(upstreamUrl);
    return {
      contextUser: this.context.authInfo.user?.sub ?? null,
      contextToken: this.context.authInfo.token ?? null,
    };
  }
}

@Tool({ name: 'session_of_caller', inputSchema: {} })
class SessionOfCallerTool extends ToolContext {
  async execute() {
    return { sessionId: this.context.sessionId };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool, SessionOfCallerTool] })
class DeskApp {}

interface WhoAmIResult {
  contextUser: string | null;
  contextToken: string | null;
}

describe('DirectMcpServer per-call authContext without a sessionId', () => {
  const originalFetch = global.fetch;

  let server: DirectMcpServer;
  let fetchMock: jest.Mock;

  async function callAs(user: string): Promise<{ result: WhoAmIResult; upstreamAuthorization: string | null }> {
    fetchMock.mockClear();
    const response = await server.callTool(
      'whoami',
      {},
      { authContext: { token: `token-of-${user}`, user: { sub: user } } },
    );
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    return {
      result: response.structuredContent as unknown as WhoAmIResult,
      upstreamAuthorization: new Headers(init.headers).get('authorization'),
    };
  }

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'direct-per-caller', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    fetchMock = jest.fn().mockImplementation(async () => new Response('{}'));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("runs a later caller's tool with that caller's this.context.authInfo", async () => {
    await callAs('alice');
    const bob = await callAs('bob');

    expect(bob.result).toEqual({ contextUser: 'bob', contextToken: 'token-of-bob' });
  });

  it("does not send an earlier caller's token from this.fetch() in a later caller's call", async () => {
    await callAs('alice');
    const bob = await callAs('bob');

    expect(bob.upstreamAuthorization).not.toBe('Bearer token-of-alice');
  });
});

describe('DirectMcpServer implicit session per caller', () => {
  let server: DirectMcpServer;

  async function sessionOf(authContext: { token?: string; user?: { sub?: string; iss?: string } }): Promise<string> {
    const response = await server.callTool('session_of_caller', {}, { authContext });
    return (response.structuredContent as { sessionId: string }).sessionId;
  }

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'direct-session-per-caller', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('keeps one session for repeated calls from the same caller', async () => {
    const caller = { token: 'token-a', user: { sub: 'alice', iss: 'https://idp.example' } };

    expect(await sessionOf(caller)).toBe(await sessionOf(caller));
  });

  it('keys callers with an empty subject by their token', async () => {
    const first = await sessionOf({ token: 'token-a', user: { sub: '' } });
    const second = await sessionOf({ token: 'token-b', user: { sub: '' } });

    expect(first).not.toBe(second);
  });

  it('keeps the same subject from two issuers apart', async () => {
    const first = await sessionOf({ token: 'token-a', user: { sub: 'alice', iss: 'https://idp-one.example' } });
    const second = await sessionOf({ token: 'token-b', user: { sub: 'alice', iss: 'https://idp-two.example' } });

    expect(first).not.toBe(second);
  });
});

describe('DirectMcpServer with @FrontMcp({ fetch }) allow-listing the upstream origin', () => {
  const originalFetch = global.fetch;

  it("sends each caller's own token from this.fetch()", async () => {
    const fetchMock = jest.fn().mockImplementation(async () => new Response('{}'));
    global.fetch = fetchMock;
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'direct-allow-listed', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      fetch: { forwardCallerTokenTo: [new URL(upstreamUrl).origin] },
    });

    try {
      const sentAuthorization: Array<string | null> = [];
      for (const user of ['alice', 'bob']) {
        fetchMock.mockClear();
        await server.callTool('whoami', {}, { authContext: { token: `token-of-${user}`, user: { sub: user } } });
        const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
        sentAuthorization.push(new Headers(init.headers).get('authorization'));
      }

      expect(sentAuthorization).toEqual(['Bearer token-of-alice', 'Bearer token-of-bob']);
    } finally {
      global.fetch = originalFetch;
      await server.dispose();
    }
  });
});
