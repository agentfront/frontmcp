import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';
import {
  App,
  AsyncProvider,
  FrontMcpInstance,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  ToolHook,
  type FlowCtxOf,
} from '@frontmcp/sdk';
import { TestTokenFactory } from '@frontmcp/testing';

const ISSUER = 'https://idp.example.com';
const GREETING = Symbol('greeting');
const toolsSeenByHook: string[] = [];

@Plugin({ name: 'call-recorder' })
class CallRecorderPlugin {
  @ToolHook.Will('execute')
  recordCall(ctx: FlowCtxOf<'tools:call-tool'>): void {
    toolsSeenByHook.push(ctx.toolName);
  }
}

@Tool({ name: 'greet', inputSchema: {} })
class GreetTool extends ToolContext {
  async execute() {
    return { greeting: `${this.get<string>(GREETING)} ${this.auth.user.sub}` };
  }
}

@App({
  name: 'greeter',
  tools: [GreetTool],
  plugins: [CallRecorderPlugin],
  providers: [AsyncProvider({ provide: GREETING, useFactory: async () => 'hello' })],
})
class GreeterApp {}

const tokens = new TestTokenFactory({ issuer: ISSUER, audience: ISSUER });
let handler: (request: Request) => Promise<Response>;

beforeAll(async () => {
  handler = await FrontMcpInstance.createFetchHandler({
    info: { name: 'ts-jest-cjs', version: '1.0.0' },
    apps: [GreeterApp],
    logging: { level: LogLevel.Off },
    auth: {
      mode: 'transparent',
      provider: ISSUER,
      providerConfig: { jwks: await tokens.getPublicJwks() },
      expectedAudience: ISSUER,
    },
  });
});

function callGreet(token: string): Promise<Response> {
  return handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'tools/call',
        'mcp-name': 'greet',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'greet',
          arguments: {},
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: { name: 'ts-jest-cjs', version: '1.0.0' },
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
}

describe('a FrontMCP server in a ts-jest CommonJS project', () => {
  it('verifies the bearer token with jose and runs the plugin hook in process', async () => {
    const response = await callGreet(await tokens.createTestToken({ sub: 'ada' }));
    const body = (await response.json()) as { result?: { structuredContent?: unknown } };

    expect(response.status).toBe(200);
    expect(body.result?.structuredContent).toEqual({ greeting: 'hello ada' });
    expect(toolsSeenByHook).toEqual(['greet']);
  });

  it('refuses a token signed with another key', async () => {
    const forged = await new TestTokenFactory({ issuer: ISSUER, audience: ISSUER }).createTestToken({ sub: 'eve' });

    const response = await callGreet(forged);

    expect(response.status).toBe(401);
    expect(toolsSeenByHook).toEqual(['greet']);
  });
});
