/**
 * `FeatureFlagPlugin` installed on an `@Agent` gates the agent's own tools.
 *
 * An agent's tools run through the agent's private `tools:call-tool` flow, where only plugins
 * installed on the agent apply. Their hooks are owned by the agent, which the hook registry did not
 * accept, so every tool call the agent made failed with "Unsupported hook owner kind": a flagged-off
 * tool was refused for the wrong reason, and a tool whose flag is on, or that has no flag, never ran.
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

import FeatureFlagPlugin from '../feature-flag.plugin';

const executed: string[] = [];

function flaggedTool(name: string, featureFlag?: string) {
  @Tool({ name, inputSchema: {}, ...(featureFlag ? { featureFlag } : {}) })
  class FlaggedTool extends ToolContext {
    async execute() {
      executed.push(name);
      return { ran: name };
    }
  }
  return FlaggedTool;
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

describe('FeatureFlagPlugin installed on an @Agent', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    const tools = [
      flaggedTool('beta_search', 'flag-off'),
      flaggedTool('stable_search', 'flag-on'),
      flaggedTool('plain_search'),
    ];
    const agent = (name: string, toolName: string) => {
      @Agent({
        name,
        inputSchema: {},
        llm: { adapter: callsOnce(toolName) },
        tools,
        plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: { 'flag-on': true, 'flag-off': false } })],
      })
      class FlaggedAgent extends AgentContext {}
      return FlaggedAgent;
    };

    @App({
      id: 'lab',
      name: 'Lab',
      agents: [
        agent('beta_agent', 'beta_search'),
        agent('stable_agent', 'stable_search'),
        agent('plain_agent', 'plain_search'),
      ],
    })
    class LabApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'feature-flag-agent-plugin', version: '1.0.0' },
      apps: [LabApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    executed.length = 0;
  });

  it("refuses the agent's tool whose flag is off", async () => {
    const result = await server.callTool('invoke_beta_agent', {});

    expect(executed).toEqual([]);
    expect(JSON.stringify(result)).toContain('disabled by feature flag');
  });

  it("runs the agent's tool whose flag is on", async () => {
    await server.callTool('invoke_stable_agent', {});

    expect(executed).toEqual(['stable_search']);
  });

  it("runs the agent's tool that has no flag", async () => {
    await server.callTool('invoke_plain_agent', {});

    expect(executed).toEqual(['plain_search']);
  });
});
