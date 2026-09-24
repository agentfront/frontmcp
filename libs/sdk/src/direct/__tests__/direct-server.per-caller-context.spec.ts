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

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
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
