/**
 * `appliesTo: 'uncovered-apps'`: a hook of a plugin installed on one app also runs for the entries
 * of apps that have no instance of that hook themselves, and never for an app that does.
 *
 * Gates such as approval and feature flags are hooks of the app they are installed on, and an
 * app's hooks only run for that app's entries, so an entry that asked for the gate in another app
 * ran ungated.
 */
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  App,
  DynamicPlugin,
  FlowHooksOf,
  LogLevel,
  Plugin,
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

const runs: string[] = [];

interface GateOptions {
  label: string;
}

@Plugin({ name: 'uncovered-gate' })
class GatePlugin extends DynamicPlugin<GateOptions> {
  readonly options: GateOptions;

  constructor(options: GateOptions) {
    super();
    this.options = options;
  }

  @ToolHook.Will('execute', { appliesTo: 'uncovered-apps' })
  gateTool(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`${this.options.label}:${ctx.state.tool?.name}`);
  }

  @ReadResourceHook.Will('execute', { appliesTo: 'uncovered-apps' })
  gateResource(ctx: FlowCtxOf<'resources:read-resource'>) {
    runs.push(`${this.options.label}:${ctx.state.resource?.name}`);
  }
}

@Plugin({ name: 'own-app-audit' })
class OwnAppAuditPlugin {
  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`audit:${ctx.state.tool?.name}`);
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

function apps(options: { gammaGate: boolean }) {
  @App({
    id: 'alpha',
    name: 'Alpha',
    tools: [toolNamed('alpha_tool')],
    plugins: [GatePlugin.init({ label: 'alpha' }), OwnAppAuditPlugin],
  })
  class AlphaApp {}

  @App({ id: 'beta', name: 'Beta', tools: [toolNamed('beta_tool')], resources: [BetaFeedResource] })
  class BetaApp {}

  @App({
    id: 'gamma',
    name: 'Gamma',
    tools: [toolNamed('gamma_tool')],
    plugins: options.gammaGate ? [GatePlugin.init({ label: 'gamma' })] : [],
  })
  class GammaApp {}

  return [AlphaApp, BetaApp, GammaApp];
}

async function hooksFor(server: DirectMcpServer, call: () => Promise<unknown>): Promise<string[]> {
  runs.length = 0;
  await call();
  return [...runs].sort();
}

describe("hooks with appliesTo: 'uncovered-apps'", () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'uncovered-apps', version: '1.0.0' },
      apps: apps({ gammaGate: true }),
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("runs only the app's own instance for the app's entries", async () => {
    expect(await hooksFor(server, () => server.callTool('alpha_tool', {}))).toEqual([
      'alpha:alpha_tool',
      'audit:alpha_tool',
    ]);
    expect(await hooksFor(server, () => server.callTool('gamma_tool', {}))).toEqual(['gamma:gamma_tool']);
  });

  it('runs every other instance for an app without one, and not own-app hooks', async () => {
    expect(await hooksFor(server, () => server.callTool('beta_tool', {}))).toEqual([
      'alpha:beta_tool',
      'gamma:beta_tool',
    ]);
  });

  it('applies to resource reads as well', async () => {
    expect(await hooksFor(server, () => server.readResource('beta://feed'))).toEqual([
      'alpha:beta-feed',
      'gamma:beta-feed',
    ]);
  });
});

@Plugin({ name: 'server-gate', plugins: [GatePlugin.init({ label: 'server' })] })
class ServerGatePlugin {}

describe("hooks with appliesTo: 'uncovered-apps' next to a server-level instance", () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'uncovered-apps-server', version: '1.0.0' },
      apps: apps({ gammaGate: false }),
      plugins: [ServerGatePlugin],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('leaves the entries of an app without its own instance to the server-level one', async () => {
    expect(await hooksFor(server, () => server.callTool('beta_tool', {}))).toEqual(['server:beta_tool']);
    expect(await hooksFor(server, () => server.callTool('gamma_tool', {}))).toEqual(['server:gamma_tool']);
  });

  it("still runs the app's own instance for its entries", async () => {
    expect(await hooksFor(server, () => server.callTool('alpha_tool', {}))).toEqual([
      'alpha:alpha_tool',
      'audit:alpha_tool',
      'server:alpha_tool',
    ]);
  });
});
