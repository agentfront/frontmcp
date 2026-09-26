/**
 * CodeCall's skill search tools serve only the skills the SDK's `skills:filter` flow lets the caller see.
 *
 * `FeatureFlagPlugin` drops a flag-disabled skill in that flow; the plugin here drops skills tagged
 * `flag-off` the same way, so every other skill surface already treats them as absent.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import {
  App,
  createInMemoryServer,
  FlowHooksOf,
  FrontMcpInstance,
  LogLevel,
  Plugin,
  Skill,
  SkillContext,
  Tool,
  ToolContext,
  type FlowCtxOf,
} from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

const FilterSkillsHook = FlowHooksOf('skills:filter');

@Plugin({ name: 'flag-off-skills' })
class FlagOffSkillsPlugin {
  @FilterSkillsHook.Did('filterSkills')
  dropFlagOffSkills(ctx: FlowCtxOf<'skills:filter'>) {
    ctx.state.set(
      'skills',
      ctx.state.required.skills.filter((skill) => !skill.metadata.tags?.includes('flag-off')),
    );
  }
}

@Tool({ name: 'issue_refund', description: 'Issues a refund', inputSchema: {} })
class IssueRefundTool extends ToolContext {
  async execute() {
    return { refunded: true };
  }
}

@Skill({
  name: 'refund-order',
  description: 'Refund an order for a customer',
  instructions: 'Call issue_refund.',
  tools: ['issue_refund'],
})
class RefundOrderSkill extends SkillContext {}

@Skill({
  name: 'refund-everything',
  description: 'Refund every order for every customer',
  instructions: 'Call issue_refund for every order.',
  tools: ['issue_refund'],
  tags: ['flag-off'],
})
class RefundEverythingSkill extends SkillContext {}

@Skill({
  name: 'refund-policy',
  description: 'The refund policy for customers',
  instructions: 'Refunds are allowed within 30 days.',
})
class RefundPolicySkill extends SkillContext {}

@Skill({
  name: 'refund-overrides',
  description: 'The refund policy overrides for staff',
  instructions: 'Staff may refund any order.',
  tags: ['flag-off'],
})
class RefundOverridesSkill extends SkillContext {}

interface SearchedSkills {
  skills?: Array<{ name: string }>;
  knowledge?: Array<{ name: string }>;
  totalExecutableSkills?: number;
  totalKnowledgeSkills?: number;
}

function readStructured(result: CallToolResult): SearchedSkills {
  if (result.structuredContent) return result.structuredContent as SearchedSkills;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as SearchedSkills;
}

describe('CodeCall skill search through the skills:filter flow', () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    @App({
      id: 'billing',
      name: 'Billing',
      tools: [IssueRefundTool],
      skills: [RefundOrderSkill, RefundEverythingSkill, RefundPolicySkill, RefundOverridesSkill],
      plugins: [CodeCallPlugin.init({ mode: 'codecall_only' }), FlagOffSkillsPlugin],
    })
    class BillingApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'codecall-skill-filter', version: '1.0.0' },
      apps: [BillingApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');

    const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    closeServer = close;
    client = new Client({ name: 'codecall-skill-filter-spec', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await closeServer();
  });

  async function search(tool: string): Promise<SearchedSkills> {
    const result = (await client.callTool({
      name: tool,
      arguments: { queries: ['refund order customer', 'refund policy staff'], topK: 10, minRelevanceScore: 0 },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    return readStructured(result);
  }

  it('leaves a skill the flow drops out of codecall:searchSkills and its total', async () => {
    const { skills, totalExecutableSkills } = await search('codecall:searchSkills');
    const names = (skills ?? []).map((skill) => skill.name);

    expect(names).toContain('refund-order');
    expect(names).not.toContain('refund-everything');
    expect(totalExecutableSkills).toBe(1);
  });

  it('leaves a skill the flow drops out of codecall:searchKnowledge and its total', async () => {
    const { knowledge, totalKnowledgeSkills } = await search('codecall:searchKnowledge');
    const names = (knowledge ?? []).map((skill) => skill.name);

    expect(names).toContain('refund-policy');
    expect(names).not.toContain('refund-overrides');
    expect(totalKnowledgeSkills).toBe(1);
  });
});
