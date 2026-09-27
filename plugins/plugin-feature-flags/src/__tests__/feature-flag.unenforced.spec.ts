/**
 * `featureFlag` must never be silently ignored.
 *
 * The flag is enforced by `FeatureFlagPlugin`'s hooks alone. On a server where no feature-flag
 * plugin reaches an entry, a flagged-off entry was listed and served, and `@Agent({ featureFlag })`
 * was never gated at all: the field was not carried over to the agent's `invoke_<agent>` tool,
 * so even an installed plugin never saw it. The server now refuses to start without a plugin
 * that enforces it, and an agent's flag hides and refuses its tool like a tool's.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  UnenforcedMetadataError,
  type DirectMcpServer,
  type FrontMcpConfigInput,
} from '@frontmcp/sdk';

import FeatureFlagPlugin from '../feature-flag.plugin';

const FLAGS = { 'flag-on': true, 'flag-off': false };

/** Server-level plugins: the config type names plugin classes, and an `init()` result is accepted at run time. */
const serverPlugins = (...plugins: unknown[]) => plugins as FrontMcpConfigInput['plugins'];
const executed: string[] = [];

@Tool({ name: 'beta_export', inputSchema: {}, featureFlag: 'flag-off' })
class BetaExportTool extends ToolContext {
  async execute() {
    executed.push('beta_export');
    return { exported: true };
  }
}

@Agent({
  name: 'beta_planner',
  description: 'Plans beta rollouts',
  inputSchema: {},
  llm: { adapter: { completion: async () => ({ content: 'planned', finishReason: 'stop' as const }) } },
  featureFlag: 'flag-off',
})
class BetaPlannerAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    executed.push('beta_planner');
    return { planned: true };
  }
}

function config(app: Record<string, unknown>, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  @App({ id: 'lab', name: 'Lab', ...app })
  class LabApp {}
  return {
    info: { name: 'feature-flag-unenforced', version: '1.0.0' },
    apps: [LabApp],
    logging: { level: LogLevel.Off },
    ...extra,
  };
}

function errorMessageOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe('featureFlag without a feature-flag plugin', () => {
  it('refuses to start a server whose flagged tool no plugin enforces', async () => {
    const startup = FrontMcpInstance.createDirect(config({ tools: [BetaExportTool] }));

    await expect(startup).rejects.toBeInstanceOf(UnenforcedMetadataError);
    await expect(startup).rejects.toThrow(/Tool "beta_export".*'featureFlag'/);
  });

  it('refuses to start a server whose flagged agent no plugin enforces', async () => {
    const startup = FrontMcpInstance.createDirect(config({ agents: [BetaPlannerAgent] }));

    await expect(startup).rejects.toThrow(/Agent "beta_planner".*'featureFlag'/);
  });

  it('starts with FeatureFlagPlugin on the server', async () => {
    const server = await FrontMcpInstance.createDirect(
      config(
        { tools: [BetaExportTool] },
        { plugins: serverPlugins(FeatureFlagPlugin.init({ adapter: 'static', flags: FLAGS })) },
      ),
    );
    try {
      expect(await errorMessageOf(server.callTool('beta_export', {}))).toMatch(/disabled by feature flag/);
    } finally {
      await server.dispose();
    }
  });
});

describe('@Agent({ featureFlag })', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    executed.length = 0;
    server = await FrontMcpInstance.createDirect(
      config({ agents: [BetaPlannerAgent], plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: FLAGS })] }),
    );
  });

  afterEach(async () => {
    await server.dispose();
  });

  it("hides the agent's tool while its flag is off", async () => {
    const { tools } = await server.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain('invoke_beta_planner');
  });

  it("refuses the agent's tool while its flag is off", async () => {
    expect(await errorMessageOf(server.callTool('invoke_beta_planner', {}))).toMatch(/disabled by feature flag/);
    expect(executed).toEqual([]);
  });
});
