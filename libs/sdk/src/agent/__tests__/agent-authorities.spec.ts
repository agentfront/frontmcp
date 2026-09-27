import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { Agent, AgentContext, App, Tool, ToolContext } from '../../common';

/**
 * `@Agent({ authorities })` must gate the agent's `invoke_<id>` tool exactly like
 * `@Tool({ authorities })` gates a tool: hidden from callers who don't satisfy the
 * rule, and refused when called by name.
 */

const llmAdapter = {
  completion: jest.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' }),
};

@Agent({
  name: 'refunds',
  description: 'Issues refunds',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  authorities: 'admin',
})
class RefundsAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    return { refunded: true };
  }
}

const lookups: string[] = [];

@Tool({ name: 'lookup_order', inputSchema: {}, authorities: 'admin' })
class LookupOrderTool extends ToolContext {
  async execute() {
    lookups.push(this.auth.user.sub);
    return { order: 'o-1' };
  }
}

/** An LLM that calls `lookup_order` once, then answers with what the tool returned. */
const triageAdapter = {
  completion: jest.fn(async (prompt: { messages: Array<{ role: string; content: string | null }> }) => {
    const last = prompt.messages[prompt.messages.length - 1];
    if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
    return {
      content: null,
      finishReason: 'tool_calls' as const,
      toolCalls: [{ id: 'call-1', name: 'lookup_order', arguments: {} }],
    };
  }),
};

@Agent({
  name: 'triage',
  description: 'Triages tickets',
  inputSchema: {},
  llm: { adapter: triageAdapter },
  tools: [LookupOrderTool],
})
class TriageAgent extends AgentContext {}

@Agent({
  name: 'triage_direct',
  description: 'Triages tickets, calling its tools directly',
  inputSchema: {},
  llm: { adapter: triageAdapter },
  tools: [LookupOrderTool],
  execution: { useToolFlow: false },
})
class TriageDirectAgent extends AgentContext {}

@App({ id: 'desk', name: 'Desk', agents: [RefundsAgent, TriageAgent, TriageDirectAgent] })
class DeskApp {}

interface ToolCallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
}

describe('@Agent({ authorities })', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;
  let admin: Record<string, string>;
  let member: Record<string, string>;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer({
      info: { name: 'agent-authorities', version: '1.0.0' },
      apps: [DeskApp],
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        allowAnonymous: true,
      },
      authorities: {
        claimsMapping: { roles: 'roles' },
        profiles: { admin: { roles: { any: ['admin'] } } },
      },
    });
    admin = { authorization: `Bearer ${await issuer.sign({ roles: ['admin'] }, 'ada')}` };
    member = { authorization: `Bearer ${await issuer.sign({ roles: ['member'] }, 'max')}` };
  });

  async function listToolNames(headers: Record<string, string> = {}): Promise<string[]> {
    const { message } = await rpc20260728(server.handler, 'tools/list', {}, { headers });
    return ((message.result?.['tools'] as Array<{ name: string }> | undefined) ?? []).map((tool) => tool.name);
  }

  async function invoke(headers: Record<string, string> = {}): Promise<ToolCallResult> {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'invoke_refunds', arguments: {} },
      { headers },
    );
    return message.result as ToolCallResult;
  }

  it('hides invoke_<agent> from callers the rule refuses', async () => {
    expect({
      anonymous: (await listToolNames()).includes('invoke_refunds'),
      member: (await listToolNames(member)).includes('invoke_refunds'),
      admin: (await listToolNames(admin)).includes('invoke_refunds'),
    }).toEqual({ anonymous: false, member: false, admin: true });
  });

  it('refuses invoke_<agent> for callers the rule refuses', async () => {
    const anonymous = await invoke();
    const byMember = await invoke(member);

    expect([anonymous, byMember].map((result) => ({ isError: result.isError, code: result._meta?.['code'] }))).toEqual([
      { isError: true, code: 'AUTHORITY_DENIED' },
      { isError: true, code: 'AUTHORITY_DENIED' },
    ]);
  });

  it('runs invoke_<agent> for a caller the rule admits', async () => {
    const result = await invoke(admin);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ refunded: true });
  });
});

describe('authorities on a tool of an @Agent', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer({
      info: { name: 'agent-tool-authorities', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
      authorities: {
        claimsMapping: { roles: 'roles' },
        profiles: { admin: { roles: { any: ['admin'] } } },
      },
    });
  });

  it.each(['invoke_triage', 'invoke_triage_direct'])('are enforced for the caller %s runs for', async (tool) => {
    lookups.length = 0;
    for (const [sub, roles] of [
      ['max', ['member']],
      ['ada', ['admin']],
    ] as const) {
      const token = await issuer.sign({ roles }, sub);
      await rpc20260728(
        server.handler,
        'tools/call',
        { name: tool, arguments: {} },
        { headers: { authorization: `Bearer ${token}` } },
      );
    }

    expect(lookups).toEqual(['ada']);
  });
});

describe('@Agent({ authorities }) without the server authorities option', () => {
  it('fails at startup', async () => {
    await expect(
      createTestFetchServer({ info: { name: 'agent-authorities-unconfigured', version: '1.0.0' }, apps: [DeskApp] }),
    ).rejects.toThrow(/Authorities configuration required/);
  });
});
