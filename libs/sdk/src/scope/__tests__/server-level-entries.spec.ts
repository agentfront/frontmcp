// `@FrontMcp({ tools, resources })` are served to every app through the same flows as app entries (#703).
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import { DirectMcpServerImpl } from '../../direct/direct-server';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  LogLevel,
  Plugin,
  Provider,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Skill,
  Tool,
  ToolContext,
  ToolHook,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '../../index';
import { SkillValidationError } from '../../skill/errors/skill-validation.error';
import { type Scope } from '../scope.instance';

const hookRuns: string[] = [];

@Provider({ name: 'server-greeting' })
class ServerGreeting {
  readonly text = 'pong';
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  @ToolHook.Will('execute')
  beforeExecute() {
    hookRuns.push('class:ping');
  }

  async execute() {
    return { reply: this.get(ServerGreeting).text, from: 'server' };
  }
}

@Tool({ name: 'deno_only', inputSchema: {}, availableWhen: { runtime: ['deno'] } })
class DenoOnlyTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Resource({ name: 'server-status', uri: 'status://server' })
class ServerStatusResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'server is up' }] };
  }
}

@ResourceTemplate({ name: 'server-ticket', uriTemplate: 'tickets://{id}' })
class ServerTicketTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: `ticket ${params.id}` }] };
  }
}

@Plugin({ name: 'server-audit' })
class ServerAuditPlugin {
  @ToolHook.Will('execute')
  beforeExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
    hookRuns.push(`plugin:${ctx.state.tool?.name}`);
  }
}

function appTool(name: string, from: string) {
  @Tool({ name, inputSchema: {} })
  class AppTool extends ToolContext {
    async execute() {
      return { from };
    }
  }
  return AppTool;
}

function app(id: string, entries: Record<string, unknown> = {}) {
  @App({ id, name: id, ...entries })
  class NamedApp {}
  return NamedApp;
}

function serverConfig(extra: Partial<FrontMcpConfigInput>): FrontMcpConfigInput {
  return {
    info: { name: 'server-level-entries', version: '1.0.0' },
    logging: { level: LogLevel.Off },
    apps: [],
    providers: [ServerGreeting],
    tools: [PingTool],
    ...extra,
  } as FrontMcpConfigInput;
}

async function toolNamesOf(server: DirectMcpServer): Promise<string[]> {
  const { tools } = await server.listTools();
  return tools.map((tool) => tool.name).sort();
}

function textOf(result: ReadResourceResult): string | undefined {
  return (result.contents[0] as { text?: string }).text;
}

/** One direct server per scope the config builds, keyed by scope id. */
async function serversPerScope(config: FrontMcpConfigInput): Promise<Map<string, DirectMcpServer>> {
  const instance = await FrontMcpInstance.createForGraph(config);
  return new Map(instance.getScopes().map((scope) => [scope.id, new DirectMcpServerImpl(scope as Scope)]));
}

async function disposeAll(servers: Map<string, DirectMcpServer>): Promise<void> {
  await Promise.all([...servers.values()].map((server) => server.dispose()));
}

describe('server-level tools and resources', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(
      serverConfig({
        apps: [app('desk', { tools: [appTool('open_ticket', 'desk')] })],
        tools: [PingTool, DenoOnlyTool],
        resources: [ServerStatusResource, ServerTicketTemplate],
        plugins: [ServerAuditPlugin],
      }),
    );
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    hookRuns.length = 0;
  });

  it('lists a server-level tool next to the app tools', async () => {
    expect(await toolNamesOf(server)).toEqual(['open_ticket', 'ping']);
  });

  it('calls a server-level tool with the server providers', async () => {
    const result = await server.callTool('ping', {});
    expect(result.structuredContent).toEqual({ reply: 'pong', from: 'server' });
  });

  it('runs a server-level plugin hook and the tool class hook for a server-level tool', async () => {
    await server.callTool('ping', {});
    expect(hookRuns.sort()).toEqual(['class:ping', 'plugin:ping']);
  });

  it('leaves out a server-level tool this process does not serve', async () => {
    await expect(server.callTool('deno_only', {})).rejects.toThrow();
  });

  it('lists and reads a server-level resource', async () => {
    const { resources } = await server.listResources();
    expect(resources.map((resource) => resource.uri)).toContain('status://server');
    expect(textOf(await server.readResource('status://server'))).toBe('server is up');
  });

  it('lists and reads a server-level resource template', async () => {
    const { resourceTemplates } = await server.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toContain('tickets://{id}');
    expect(textOf(await server.readResource('tickets://42'))).toBe('ticket 42');
  });
});

describe('app plugin hooks and a server-level tool', () => {
  it('run only when the hook applies to uncovered apps', async () => {
    @Plugin({ name: 'desk-audit' })
    class DeskAuditPlugin {
      @ToolHook.Will('execute')
      beforeExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
        hookRuns.push(`own-app:${ctx.state.tool?.name}`);
      }
    }

    @Plugin({ name: 'desk-gate' })
    class DeskGatePlugin {
      @ToolHook.Will('execute', { appliesTo: 'uncovered-apps' })
      beforeExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
        hookRuns.push(`uncovered-apps:${ctx.state.tool?.name}`);
      }
    }

    const server = await FrontMcpInstance.createDirect(
      serverConfig({ apps: [app('desk', { plugins: [DeskAuditPlugin, DeskGatePlugin] })] }),
    );
    hookRuns.length = 0;
    try {
      await server.callTool('ping', {});
      expect(hookRuns.sort()).toEqual(['class:ping', 'uncovered-apps:ping']);
    } finally {
      await server.dispose();
    }
  });
});

describe('server-level tool named like an app tool', () => {
  it('lists both, the server tool prefixed with `server`, and calls each by its listed name', async () => {
    const server = await FrontMcpInstance.createDirect(
      serverConfig({ apps: [app('desk', { tools: [appTool('ping', 'desk')] })] }),
    );
    try {
      expect(await toolNamesOf(server)).toEqual(['desk:ping', 'server:ping']);
      expect((await server.callTool('server:ping', {})).structuredContent).toEqual({ reply: 'pong', from: 'server' });
      expect((await server.callTool('desk:ping', {})).structuredContent).toEqual({ from: 'desk' });
    } finally {
      await server.dispose();
    }
  });
});

describe('server-level tools on a server with several scopes', () => {
  it('serves a server-level tool once to the apps sharing a scope', async () => {
    const server = await FrontMcpInstance.createDirect(
      serverConfig({ apps: [app('billing', { tools: [appTool('charge', 'billing')] }), app('crm')] }),
    );
    try {
      expect(await toolNamesOf(server)).toEqual(['charge', 'ping']);
    } finally {
      await server.dispose();
    }
  });

  it('serves a server-level tool in the scope of a standalone app too', async () => {
    const servers = await serversPerScope(
      serverConfig({
        apps: [app('billing', { tools: [appTool('charge', 'billing')] }), app('ops', { standalone: true })],
      }),
    );
    try {
      expect(await toolNamesOf(servers.get('root') as DirectMcpServer)).toEqual(['charge', 'ping']);
      expect(await toolNamesOf(servers.get('ops') as DirectMcpServer)).toEqual(['ping']);
    } finally {
      await disposeAll(servers);
    }
  });

  it('serves a server-level tool in the scope of each app with splitByApp', async () => {
    const servers = await serversPerScope(
      serverConfig({
        splitByApp: true,
        apps: [
          app('billing', { tools: [appTool('charge', 'billing')] }),
          app('crm', { tools: [appTool('ping', 'crm')] }),
        ],
      }),
    );
    try {
      const billing = servers.get('billing') as DirectMcpServer;
      const crm = servers.get('crm') as DirectMcpServer;
      expect(await toolNamesOf(billing)).toEqual(['charge', 'ping']);
      expect(await toolNamesOf(crm)).toEqual(['crm:ping', 'server:ping']);
      expect((await billing.callTool('ping', {})).structuredContent).toEqual({ reply: 'pong', from: 'server' });
      expect((await crm.callTool('server:ping', {})).structuredContent).toEqual({ reply: 'pong', from: 'server' });
      expect((await crm.callTool('crm:ping', {})).structuredContent).toEqual({ from: 'crm' });
    } finally {
      await disposeAll(servers);
    }
  });
});

describe('server-level tools at startup', () => {
  it('validates a skill that names a server-level tool', async () => {
    @Skill({
      name: 'pinger',
      description: 'Pings',
      instructions: 'Call ping.',
      tools: ['ping'],
      toolValidation: 'strict',
    })
    class PingerSkill {}

    const server = await FrontMcpInstance.createDirect(serverConfig({ apps: [app('desk')], skills: [PingerSkill] }));
    await server.dispose();
  });

  it('still refuses a skill that names a tool no one serves', async () => {
    @Skill({
      name: 'ghost',
      description: 'Ghost',
      instructions: 'Call ghost.',
      tools: ['ghost'],
      toolValidation: 'strict',
    })
    class GhostSkill {}

    await expect(
      FrontMcpInstance.createDirect(serverConfig({ apps: [app('desk')], skills: [GhostSkill] })),
    ).rejects.toBeInstanceOf(SkillValidationError);
  });

  it('fails startup on a server-level tool class hook that could never run', async () => {
    @Tool({ name: 'early', inputSchema: {} })
    class EarlyTool extends ToolContext {
      @ToolHook.Will('findTool')
      early() {
        hookRuns.push('never');
      }

      async execute() {
        return {};
      }
    }

    await expect(
      FrontMcpInstance.createDirect(serverConfig({ apps: [app('desk')], tools: [EarlyTool] })),
    ).rejects.toThrow(/Tool "EarlyTool" declares hooks that would never run/);
  });
});
