/**
 * A server whose entries declare `authorities` without the `authorities` option refuses to start. The entries an
 * agent keeps in its private scope count too: its resources, resource templates and prompts, which its model
 * reads through the resource and prompt flows, and the tools of its nested agents at any depth, which run through
 * the call-tool flow. These were left out of the check, so they were served while their rules checked nothing.
 */
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  Agent,
  AgentContext,
  App,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../common';
import { AuthConfigurationError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

// `authorities` is declared by the type augmentation of @frontmcp/auth, which these tests do not load.
const ADMIN_ONLY: Record<string, unknown> = { authorities: { roles: { any: ['admin'] } } };

@Resource({ name: 'payroll', uri: 'hr://payroll', ...ADMIN_ONLY })
class PayrollResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'salaries' }] };
  }
}

@ResourceTemplate({ name: 'salary', uriTemplate: 'hr://salaries/{id}', ...ADMIN_ONLY })
class SalaryTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'salary' }] };
  }
}

@Prompt({ name: 'raise_letter', arguments: [], ...ADMIN_ONLY })
class RaiseLetterPrompt extends PromptContext {
  async execute() {
    return { messages: [] };
  }
}

@Tool({ name: 'wipe_ledger', inputSchema: {}, ...ADMIN_ONLY })
class WipeLedgerTool extends ToolContext {
  async execute() {
    return { wiped: true };
  }
}

const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

@Agent({ name: 'payroll_agent', inputSchema: {}, llm, resources: [PayrollResource] })
class PayrollAgent extends AgentContext {}

@Agent({ name: 'salary_agent', inputSchema: {}, llm, resources: [SalaryTemplate] })
class SalaryAgent extends AgentContext {}

@Agent({ name: 'letters_agent', inputSchema: {}, llm, prompts: [RaiseLetterPrompt] })
class LettersAgent extends AgentContext {}

@Agent({ name: 'ledger_agent', inputSchema: {}, llm, tools: [WipeLedgerTool] })
class LedgerAgent extends AgentContext {}

@Agent({ name: 'finance_agent', inputSchema: {}, llm, agents: [LedgerAgent] })
class FinanceAgent extends AgentContext {}

function server(agents: unknown[], extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  @App({ id: 'hr', name: 'HR', agents: agents as never })
  class HrApp {}
  return {
    info: { name: 'authorities-agent-scopes', version: '1.0.0' },
    apps: [HrApp],
    logging: { level: LogLevel.Off },
    ...extra,
  };
}

async function start(config: FrontMcpConfigInput): Promise<void> {
  const direct = await FrontMcpInstance.createDirect(config);
  await direct.dispose();
}

describe("startup check of authorities in an agent's private scope", () => {
  it.each([
    ['a resource', PayrollAgent, /Resource "payroll_agent:payroll"/],
    ['a resource template', SalaryAgent, /Resource template "salary_agent:salary"/],
    ['a prompt', LettersAgent, /Prompt "letters_agent:raise_letter"/],
    ["a nested agent's tool", FinanceAgent, /Tool "finance_agent:ledger_agent:wipe_ledger"/],
  ])('refuses to start when %s declares authorities and no engine checks them', async (_label, agent, entry) => {
    const startup = start(server([agent]));

    await expect(startup).rejects.toBeInstanceOf(AuthConfigurationError);
    await expect(startup).rejects.toThrow(entry);
  });

  it('starts when the authorities option configures the engine', async () => {
    await expect(
      start(server([PayrollAgent, SalaryAgent, LettersAgent, FinanceAgent], { authorities: {} })),
    ).resolves.toBeUndefined();
  });
});
