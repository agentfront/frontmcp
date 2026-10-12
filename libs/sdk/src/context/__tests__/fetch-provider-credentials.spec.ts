import 'reflect-metadata';

import { AUTH_PROVIDERS_ACCESSOR } from '@frontmcp/auth';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const providerHeaders: Record<string, Record<string, string>> = {
  github: { Authorization: 'Bearer github-token' },
  maps: { 'X-API-Key': 'maps-key' },
};

const fakeAccessor = {
  headers: async (provider: string) => providerHeaders[provider] ?? {},
};

@Tool({ name: 'call_upstream', inputSchema: {} })
class CallUpstreamTool extends ToolContext {
  async execute() {
    await this.fetch('https://api.github.com/user', { credentials: { provider: 'github' } });
    await this.fetch('https://maps.example.com/geo', { credentials: { provider: 'maps' } });
    await this.fetch('https://unknown.example.com/', { credentials: { provider: 'nobody' } });
    return { done: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [CallUpstreamTool] })
class DeskApp {}

describe('this.fetch() with credentials: { provider }', () => {
  const originalFetch = globalThis.fetch;
  const sent: Array<{ url: string; headers: Headers; credentials?: unknown; redirect?: RequestRedirect }> = [];
  let server: DirectMcpServer;

  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: String(input),
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
        redirect: init?.redirect,
      });
      return new Response('{}');
    }) as typeof fetch;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'fetch-provider-credentials', version: '1.0.0' },
      apps: [DeskApp],
      providers: [{ provide: AUTH_PROVIDERS_ACCESSOR, name: 'AuthProvidersAccessor', useValue: fakeAccessor }],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await server.dispose();
  });

  it("sends the headers the provider's credential resolves to, and never the credentials object", async () => {
    await server.callTool('call_upstream', {});

    expect(sent.map(({ url, headers }) => [url, headers.get('authorization'), headers.get('x-api-key')])).toEqual([
      ['https://api.github.com/user', 'Bearer github-token', null],
      ['https://maps.example.com/geo', null, 'maps-key'],
      ['https://unknown.example.com/', null, null],
    ]);
    expect(sent.every(({ credentials }) => credentials === undefined)).toBe(true);
  });

  it('does not follow a redirect with provider credentials, so a 3xx cannot carry them to another origin', async () => {
    sent.length = 0;
    await server.callTool('call_upstream', {});

    expect(sent.map(({ redirect }) => redirect)).toEqual(['manual', 'manual', 'manual']);
  });
});
