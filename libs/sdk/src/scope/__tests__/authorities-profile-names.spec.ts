import 'reflect-metadata';

import { createTestFetchServer, rpc20260728 } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  Agent,
  AgentContext,
  App,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Skill,
  SkillContext,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../common';

/**
 * An `authorities` profile name is checked when the server starts, like the rest of the rule
 * (#266): a name no profile has (`'admn'` for `'admin'`) refused every caller at call time while
 * the server started normally. Every entry kind the startup check covers is checked.
 */

const authorities = {
  claimsMapping: { roles: 'roles' },
  profiles: { admin: { roles: { any: ['admin'] } }, support: { roles: { any: ['support'] } } },
};

function serverWith(app: Record<string, unknown>): FrontMcpConfigInput {
  @App({ id: 'desk', name: 'Desk', ...app })
  class DeskApp {}
  return { info: { name: 'authorities-profile-names', version: '1.0.0' }, apps: [DeskApp], authorities };
}

type EntryKind = 'tool' | 'resource' | 'template' | 'prompt' | 'agent' | 'agentTool' | 'skill';

/** For each entry kind, the app contents declaring one such entry with `authorities: rule`. */
function entriesWith(rule: unknown): Record<EntryKind, Record<string, unknown>> {
  const value = rule as 'admin';

  @Tool({ name: 'refund', inputSchema: {}, authorities: value })
  class RefundTool extends ToolContext {
    async execute() {
      return {};
    }
  }

  @Resource({ name: 'audit', uri: 'audit://log', authorities: value })
  class AuditResource extends ResourceContext {
    async execute(uri: string) {
      return { contents: [{ uri, text: 'audit' }] };
    }
  }

  @ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}', mimeType: 'text/plain', authorities: value })
  class TicketTemplate extends ResourceContext<{ id: string }> {
    async execute(uri: string) {
      return { contents: [{ uri, text: 'ticket' }] };
    }
  }

  @Prompt({ name: 'escalate', arguments: [], authorities: value })
  class EscalatePrompt extends PromptContext {
    async execute() {
      return { messages: [] };
    }
  }

  const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

  @Agent({ name: 'triage', inputSchema: {}, llm, authorities: value })
  class TriageAgent extends AgentContext {}

  @Tool({ name: 'lookup_order', inputSchema: {}, authorities: value })
  class LookupOrderTool extends ToolContext {
    async execute() {
      return {};
    }
  }

  @Agent({ name: 'billing', inputSchema: {}, llm, tools: [LookupOrderTool] })
  class BillingAgent extends AgentContext {}

  @Skill({ name: 'refund-playbook', description: 'How to refund', instructions: 'Steps.', authorities: value })
  class RefundPlaybookSkill extends SkillContext {}

  return {
    tool: { tools: [RefundTool] },
    resource: { resources: [AuditResource] },
    template: { resources: [TicketTemplate] },
    prompt: { prompts: [EscalatePrompt] },
    agent: { agents: [TriageAgent] },
    agentTool: { agents: [BillingAgent] },
    skill: { skills: [RefundPlaybookSkill] },
  };
}

const LABELS: Record<EntryKind, string> = {
  tool: 'Tool "refund"',
  resource: 'Resource "audit"',
  template: 'Resource template "ticket"',
  prompt: 'Prompt "escalate"',
  agent: 'Agent "triage"',
  agentTool: 'Tool "billing:lookup_order"',
  skill: 'Skill "refund-playbook"',
};

const KINDS = Object.keys(LABELS) as EntryKind[];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('startup check for authorities profile names', () => {
  const unknownName = entriesWith('admn');
  const unknownInList = entriesWith(['admin', 'admn']);

  it.each(KINDS)('refuses to start when a %s names a profile that does not exist', async (kind) => {
    const startup = createTestFetchServer(serverWith(unknownName[kind]));

    await expect(startup).rejects.toThrow(/Invalid authorities rule/);
    await expect(startup).rejects.toThrow(
      new RegExp(`${escape(LABELS[kind])}: authorities names an unknown profile "admn"`),
    );
  });

  it.each(KINDS)('refuses to start when a %s lists a profile that does not exist among real ones', async (kind) => {
    const startup = createTestFetchServer(serverWith(unknownInList[kind]));

    await expect(startup).rejects.toThrow(
      new RegExp(`${escape(LABELS[kind])}: authorities names an unknown profile "admn"`),
    );
  });

  it('still refuses a profile name inside a combinator', async () => {
    const startup = createTestFetchServer(serverWith(entriesWith({ anyOf: ['admin'] }).tool));

    await expect(startup).rejects.toThrow(/Tool "refund": authorities\.anyOf\[0\] must be a rule object/);
  });

  it('starts with profile names that exist, and enforces them', async () => {
    const server = await createTestFetchServer(serverWith(entriesWith(['admin', 'support']).tool));

    const { message } = await rpc20260728(server.handler, 'tools/call', { name: 'refund', arguments: {} });

    expect(message.result).toMatchObject({ isError: true, _meta: { code: 'AUTHORITY_DENIED' } });
  });
});
