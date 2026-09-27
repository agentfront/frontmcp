/**
 * `ApprovalPlugin` installed on an `@Agent` gates the agent's own tools.
 *
 * An agent's tools run through the agent's private `tools:call-tool` flow, where only plugins
 * installed on the agent apply. Their hooks are owned by the agent, which the hook registry did not
 * accept, so every tool call the agent made failed with "Unsupported hook owner kind" before the
 * approval gate could judge it, whether the tool asked for approval or not.
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
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalPlugin } from '../index';

const executed: string[] = [];

@Tool({ name: 'refund_order', inputSchema: {}, approval: true })
class RefundOrderTool extends ToolContext {
  async execute() {
    executed.push('refund_order');
    return { refunded: true };
  }
}

@Tool({ name: 'lookup_order', inputSchema: {} })
class LookupOrderTool extends ToolContext {
  async execute() {
    executed.push('lookup_order');
    return { order: 'o-1' };
  }
}

/** An LLM that calls `toolName` once, then answers with what the tool returned. */
function callsOnce(toolName: string) {
  return {
    completion: async (prompt: { messages: Array<{ role: string; content: string | null }> }) => {
      const last = prompt.messages[prompt.messages.length - 1];
      if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
      return {
        content: null,
        finishReason: 'tool_calls' as const,
        toolCalls: [{ id: 'call-1', name: toolName, arguments: {} }],
      };
    },
  };
}

describe('ApprovalPlugin installed on an @Agent', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    const storage = createMemoryStorage();
    await storage.connect();
    const plugins = [ApprovalPlugin.init({ storageInstance: storage })];

    @Agent({
      name: 'refunds',
      inputSchema: {},
      llm: { adapter: callsOnce('refund_order') },
      tools: [RefundOrderTool, LookupOrderTool],
      plugins,
    })
    class RefundsAgent extends AgentContext {}

    @Agent({
      name: 'lookups',
      inputSchema: {},
      llm: { adapter: callsOnce('lookup_order') },
      tools: [RefundOrderTool, LookupOrderTool],
      plugins,
    })
    class LookupsAgent extends AgentContext {}

    @App({ id: 'desk', name: 'Desk', agents: [RefundsAgent, LookupsAgent] })
    class DeskApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-agent-plugin', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    executed.length = 0;
  });

  it("asks for approval before the agent's tool that requires it", async () => {
    const result = await server.callTool('invoke_refunds', {}, { authContext: { sessionId: 'session-alice' } });

    expect(executed).toEqual([]);
    expect(JSON.stringify(result)).toContain('requires approval');
  });

  it("runs the agent's tool that does not require approval", async () => {
    const result = await server.callTool('invoke_lookups', {}, { authContext: { sessionId: 'session-alice' } });

    expect(executed).toEqual(['lookup_order']);
    expect(JSON.stringify(result)).toContain('o-1');
  });
});
