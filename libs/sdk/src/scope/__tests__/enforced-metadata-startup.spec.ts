/**
 * Metadata that only a plugin enforces must not be silently ignored.
 *
 * `approval` (`@frontmcp/plugin-approval`) and `featureFlag` (`@frontmcp/plugin-feature-flags`) are
 * enforced by plugin hooks alone. On a server where no plugin enforcing them reaches an entry, an
 * `approval: true` tool ran freely and a flagged-off entry was listed and served. The server now
 * refuses to start instead, naming the entries, the same way it does for `authorities` without
 * the `authorities` option.
 *
 * None of these tests loads a plugin package: the SDK knows these two fields on its own, so the
 * check also holds when the plugin was never imported at all.
 */
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Skill,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type PromptMetadata,
} from '../../common';
import { UnenforcedMetadataError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');

// The plugin fields are declared by the plugin packages' type augmentation, which these tests do not load,
// so they are passed as untyped metadata.
const APPROVAL: Record<string, unknown> = { approval: true };
const BETA_FLAG: Record<string, unknown> = { featureFlag: 'beta' };

function tool(name: string, extra: Record<string, unknown> = {}) {
  @Tool({ name, inputSchema: {}, ...extra })
  class NamedTool extends ToolContext {
    async execute() {
      return { ok: true };
    }
  }
  return NamedTool;
}

@Resource({ name: 'beta-feed', uri: 'beta://feed', ...BETA_FLAG })
class BetaFeedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'beta' }] };
  }
}

@ResourceTemplate({ name: 'beta-report', uriTemplate: 'beta://reports/{id}', ...BETA_FLAG })
class BetaReportTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'beta' }] };
  }
}

// `hideFromDiscovery` is read at run time but not declared on the prompt metadata type.
@Prompt({ name: 'beta-brief', arguments: [], ...BETA_FLAG, hideFromDiscovery: true } as PromptMetadata)
class HiddenBetaPrompt extends PromptContext {
  async execute() {
    return { messages: [] };
  }
}

@Skill({ name: 'beta-runbook', description: 'Beta runbook', instructions: 'Beta steps.', ...BETA_FLAG })
class BetaRunbookSkill {}

const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

@Agent({ name: 'refunds', inputSchema: {}, llm, ...APPROVAL })
class RefundsAgent extends AgentContext {}

@Agent({ name: 'triage', inputSchema: {}, llm, tools: [tool('close_ticket', APPROVAL)] })
class TriageAgent extends AgentContext {}

/** A plugin that enforces `approval` on the tools of the app it is installed on. */
@Plugin({ name: 'own-app-approval', enforcesMetadata: ['approval'] })
class OwnAppApprovalPlugin {
  @ToolHook.Will('execute')
  gate() {
    // enforcement itself is not under test here
  }
}

/** The same, also covering the tools of apps with no instance of it (like `ApprovalPlugin`). */
@Plugin({ name: 'any-app-approval', enforcesMetadata: ['approval'] })
class AnyAppApprovalPlugin {
  @ToolHook.Will('execute', { appliesTo: 'uncovered-apps' })
  gate() {
    // enforcement itself is not under test here
  }
}

@Agent({
  name: 'guarded_triage',
  inputSchema: {},
  llm,
  tools: [tool('reopen_ticket', APPROVAL)],
  plugins: [AnyAppApprovalPlugin],
})
class GuardedTriageAgent extends AgentContext {}

/** A plugin that contributes a tool asking for approval to whatever installs it, and enforces nothing. */
@Plugin({ name: 'queue-tools', tools: [tool('purge_queue', APPROVAL)] })
class QueueToolsPlugin {}

@Agent({ name: 'queue_agent', inputSchema: {}, llm, plugins: [QueueToolsPlugin] })
class QueueAgent extends AgentContext {}

@Agent({ name: 'guarded_queue_agent', inputSchema: {}, llm, plugins: [QueueToolsPlugin, AnyAppApprovalPlugin] })
class GuardedQueueAgent extends AgentContext {}

function server(app: Record<string, unknown>, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  @App({ id: 'desk', name: 'Desk', ...app })
  class DeskApp {}
  return {
    info: { name: 'enforced-metadata', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    ...extra,
  };
}

async function start(config: FrontMcpConfigInput): Promise<void> {
  const direct = await FrontMcpInstance.createDirect(config);
  await direct.dispose();
}

describe('startup check for metadata that only a plugin enforces', () => {
  it.each([
    ['a tool with approval', { tools: [tool('wipe_disk', APPROVAL)] }, /Tool "wipe_disk".*'approval'/],
    ['a tool with a feature flag', { tools: [tool('beta_tool', BETA_FLAG)] }, /Tool "beta_tool".*'featureFlag'/],
    ['a resource with a feature flag', { resources: [BetaFeedResource] }, /Resource "beta-feed".*'featureFlag'/],
    [
      'a resource template with a feature flag',
      { resources: [BetaReportTemplate] },
      /Resource template "beta-report".*'featureFlag'/,
    ],
    ['a hidden prompt with a feature flag', { prompts: [HiddenBetaPrompt] }, /Prompt "beta-brief".*'featureFlag'/],
    ['a skill with a feature flag', { skills: [BetaRunbookSkill] }, /Skill "beta-runbook".*'featureFlag'/],
    ['an agent with approval', { agents: [RefundsAgent] }, /Agent "refunds".*'approval'/],
  ])('refuses to start with %s and no plugin that enforces it', async (_label, app, entry) => {
    const startup = start(server(app));

    await expect(startup).rejects.toBeInstanceOf(UnenforcedMetadataError);
    await expect(startup).rejects.toThrow(entry);
  });

  it('refuses to start when the enforcing plugin only covers another app', async () => {
    @App({ id: 'ops', name: 'Ops', tools: [tool('ops_tool')], plugins: [OwnAppApprovalPlugin] })
    class OpsApp {}
    @App({ id: 'desk', name: 'Desk', tools: [tool('wipe_disk', APPROVAL)] })
    class DeskApp {}

    const startup = start({ ...server({}), apps: [OpsApp, DeskApp] });

    await expect(startup).rejects.toBeInstanceOf(UnenforcedMetadataError);
    await expect(startup).rejects.toThrow(/Tool "wipe_disk".*'approval'/);
  });

  it("refuses to start when an agent's own tool asks for approval that only the server enforces", async () => {
    const startup = start(server({ agents: [TriageAgent] }, { plugins: [AnyAppApprovalPlugin] }));

    await expect(startup).rejects.toThrow(/Tool "triage:close_ticket".*'approval'/);
  });

  it("refuses to start when a tool an agent's plugin contributes asks for approval nothing on the agent enforces", async () => {
    const startup = start(server({ agents: [QueueAgent] }, { plugins: [AnyAppApprovalPlugin] }));

    await expect(startup).rejects.toBeInstanceOf(UnenforcedMetadataError);
    await expect(startup).rejects.toThrow(/Tool "queue_agent:purge_queue".*'approval'/);
  });

  it('names every entry, the first five in the message', async () => {
    const tools = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => tool(`tool_${name}`, APPROVAL));

    const startup = start(server({ tools }));

    await expect(startup).rejects.toThrow(/Tool "tool_a".*Tool "tool_e".*and 2 more/);
  });
});

describe('servers the check lets start', () => {
  it('starts when a server-level plugin enforces the field', async () => {
    await expect(
      start(server({ tools: [tool('wipe_disk', APPROVAL)] }, { plugins: [OwnAppApprovalPlugin] })),
    ).resolves.toBeUndefined();
  });

  it("starts when the entry's own app installs the enforcing plugin", async () => {
    await expect(
      start(server({ tools: [tool('wipe_disk', APPROVAL)], plugins: [OwnAppApprovalPlugin] })),
    ).resolves.toBeUndefined();
  });

  it('starts when a plugin on another app covers apps without one', async () => {
    @App({ id: 'ops', name: 'Ops', tools: [tool('ops_tool')], plugins: [AnyAppApprovalPlugin] })
    class OpsApp {}
    @App({ id: 'desk', name: 'Desk', tools: [tool('wipe_disk', APPROVAL)], agents: [RefundsAgent] })
    class DeskApp {}

    await expect(start({ ...server({}), apps: [OpsApp, DeskApp] })).resolves.toBeUndefined();
  });

  it("starts when the agent's own plugin enforces its tools' field", async () => {
    await expect(start(server({ agents: [GuardedTriageAgent] }))).resolves.toBeUndefined();
  });

  it("starts when the agent's own plugin enforces the field of a tool another of its plugins contributes", async () => {
    await expect(start(server({ agents: [GuardedQueueAgent] }))).resolves.toBeUndefined();
  });

  it('starts when the field is off or absent', async () => {
    await expect(
      start(server({ tools: [tool('safe_tool', { approval: false }), tool('plain_tool')] })),
    ).resolves.toBeUndefined();
  });
});
