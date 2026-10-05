/**
 * A plugin with `scope: 'server'` installed on one app runs its hooks for every app on the server,
 * while a plugin with the default `scope: 'app'` runs only for the app it is installed on.
 */
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Provider,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type FlowCtxOf,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const ReadResourceHook = FlowHooksOf('resources:read-resource');

const hookRuns: string[] = [];

@Plugin({ name: 'server-audit', scope: 'server' })
class ServerAuditPlugin {
  @ToolHook.Will('execute')
  auditTool(ctx: FlowCtxOf<'tools:call-tool'>) {
    hookRuns.push(`server:${ctx.state.tool?.name}`);
  }

  @ReadResourceHook.Will('execute')
  auditResource(ctx: FlowCtxOf<'resources:read-resource'>) {
    hookRuns.push(`server:${ctx.state.resource?.name}`);
  }
}

@Provider({ name: 'server-audit-provider' })
class ServerAuditProvider {
  @ToolHook.Will('execute')
  auditTool(ctx: FlowCtxOf<'tools:call-tool'>) {
    hookRuns.push(`server-provider:${ctx.state.tool?.name}`);
  }
}

@Plugin({ name: 'server-provider-audit', scope: 'server', providers: [ServerAuditProvider] })
class ServerProviderAuditPlugin {}

@Plugin({ name: 'app-audit' })
class AppAuditPlugin {
  @ToolHook.Will('execute')
  auditTool(ctx: FlowCtxOf<'tools:call-tool'>) {
    hookRuns.push(`app:${ctx.state.tool?.name}`);
  }
}

function toolNamed(name: string) {
  @Tool({ name, inputSchema: {} })
  class NamedTool extends ToolContext {
    async execute() {
      return { ok: true };
    }
  }
  return NamedTool;
}

@Resource({ name: 'beta-feed', uri: 'beta://feed' })
class BetaFeedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'ok' }] };
  }
}

@App({
  id: 'alpha',
  name: 'Alpha',
  standalone: false,
  tools: [toolNamed('alpha_tool')],
  plugins: [ServerAuditPlugin, ServerProviderAuditPlugin, AppAuditPlugin],
})
class AlphaApp {}

@App({ id: 'beta', name: 'Beta', standalone: false, tools: [toolNamed('beta_tool')], resources: [BetaFeedResource] })
class BetaApp {}

async function hooksDuring(call: () => Promise<unknown>): Promise<string[]> {
  hookRuns.length = 0;
  await call();
  return [...hookRuns].sort();
}

describe("plugin scope: 'server' on an app", () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'server-scope-plugin', version: '1.0.0' },
      apps: [AlphaApp, BetaApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('runs its hooks for the tools of the app that installed it', async () => {
    expect(await hooksDuring(() => server.callTool('alpha_tool', {}))).toEqual([
      'app:alpha_tool',
      'server-provider:alpha_tool',
      'server:alpha_tool',
    ]);
  });

  it("runs its hooks for another app's tools, unlike an app-scoped plugin", async () => {
    expect(await hooksDuring(() => server.callTool('beta_tool', {}))).toEqual([
      'server-provider:beta_tool',
      'server:beta_tool',
    ]);
  });

  it("runs its hooks for another app's resource reads", async () => {
    expect(await hooksDuring(() => server.readResource('beta://feed'))).toEqual(['server:beta-feed']);
  });
});
