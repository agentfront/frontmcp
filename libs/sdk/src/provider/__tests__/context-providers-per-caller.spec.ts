import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Provider, ProviderScope, Tool, ToolContext } from '../../common';
import { FRONTMCP_CONTEXT, type FrontMcpContext } from '../../context';

/**
 * CONTEXT-scoped providers must never be shared between callers.
 *
 * Under MCP 2026-07-28 a caller authenticated with a token has no session, so the
 * providers used to be cached under the fixed key `"anonymous"`: the first
 * caller's instance was served to everyone after them.
 */

abstract class Caller {
  abstract readonly sub: string | undefined;
  abstract readonly requestId: string;
}

let nextInstanceId = 0;
@Provider({ name: 'RequestScratchpad', scope: ProviderScope.CONTEXT })
class RequestScratchpad {
  readonly instanceId = ++nextInstanceId;
}

@Provider({ name: 'ServerScratchpad', scope: ProviderScope.CONTEXT })
class ServerScratchpad {
  readonly instanceId = ++nextInstanceId;
}

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    const caller = this.get(Caller);
    return {
      auth: this.auth.user.sub,
      provider: caller.sub ?? null,
      providerRequest: caller.requestId,
      request: this.context.requestId,
      scratchpad: this.get(RequestScratchpad).instanceId,
      serverScratchpad: this.get(ServerScratchpad).instanceId,
    };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [WhoAmITool],
  providers: [
    {
      provide: Caller,
      name: 'Caller',
      scope: ProviderScope.CONTEXT,
      inject: () => [FRONTMCP_CONTEXT] as const,
      useFactory: (ctx: FrontMcpContext) => ({ sub: ctx.authInfo.user?.sub, requestId: ctx.requestId }),
    },
    RequestScratchpad,
  ],
})
class DeskApp {}

interface WhoAmI {
  auth: string;
  provider: string | null;
  providerRequest: string;
  request: string;
  scratchpad: number;
  serverScratchpad: number;
}

describe('CONTEXT providers for callers without a session (MCP 2026-07-28, transparent tokens)', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;
  let sam: Record<string, string>;
  let nour: Record<string, string>;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer({
      info: { name: 'context-providers-per-caller', version: '1.0.0' },
      apps: [DeskApp],
      providers: [ServerScratchpad],
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
    });
    sam = { authorization: `Bearer ${await issuer.sign({}, 'sam')}` };
    nour = { authorization: `Bearer ${await issuer.sign({}, 'nour')}` };
  });

  async function whoami(headers: Record<string, string>): Promise<WhoAmI> {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name: 'whoami', arguments: {} }, { headers });
    expect(message.error).toBeUndefined();
    return message.result?.['structuredContent'] as unknown as WhoAmI;
  }

  it('builds a CONTEXT factory for the caller making the request, not the first caller', async () => {
    const first = await whoami(sam);
    const second = await whoami(nour);
    const third = await whoami(sam);

    expect([first, second, third].map(({ auth, provider }) => ({ auth, provider }))).toEqual([
      { auth: 'sam', provider: 'sam' },
      { auth: 'nour', provider: 'nour' },
      { auth: 'sam', provider: 'sam' },
    ]);
    expect(second.providerRequest).toBe(second.request);
  });

  it('builds a CONTEXT class provider once per request', async () => {
    const first = await whoami(sam);
    const second = await whoami(nour);
    const third = await whoami(sam);

    expect({
      appInstances: new Set([first.scratchpad, second.scratchpad, third.scratchpad]).size,
      serverInstances: new Set([first.serverScratchpad, second.serverScratchpad, third.serverScratchpad]).size,
    }).toEqual({ appInstances: 3, serverInstances: 3 });
  });

  it('does not let a caller join another caller’s providers by naming a session id', async () => {
    const first = await whoami({ ...sam, 'mcp-session-id': 'chosen-session-id' });
    const second = await whoami({ ...nour, 'mcp-session-id': 'chosen-session-id' });

    expect({
      provider: [first.provider, second.provider],
      sharesAppInstance: second.scratchpad === first.scratchpad,
      sharesServerInstance: second.serverScratchpad === first.serverScratchpad,
    }).toEqual({ provider: ['sam', 'nour'], sharesAppInstance: false, sharesServerInstance: false });
  });
});
