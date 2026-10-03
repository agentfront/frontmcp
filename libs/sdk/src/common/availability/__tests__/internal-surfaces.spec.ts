import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type GetPromptResult } from '@frontmcp/protocol';

import { createWebhookMiddleware } from '../../../channel/sources/webhook.source';
import { getCallSurface } from '../../../context/call-surface';
import { connect } from '../../../direct';
import type { DirectClient } from '../../../direct/client.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import type { Scope } from '../../../scope/scope.instance';
import {
  Agent,
  AgentContext,
  App,
  Channel,
  ChannelContext,
  Job,
  JobContext,
  LogLevel,
  Prompt,
  PromptContext,
  Tool,
  ToolContext,
  Workflow,
  type ChannelNotification,
} from '../../index';

/**
 * `availableWhen.surface` names who is calling: `'mcp'`, `'cli'`, `'agent'`, `'job'`, `'http-trigger'`
 * or `'webmcp'`. Each caller tags its calls, so a tool listing only `'mcp'` is out of reach of an
 * agent's model, a job (or workflow step), an HTTP trigger and an in-browser agent calling through
 * WebMCP, and a tool listing only one of those is reached by it. Code running for a call reads the call's surface with `getCallSurface()`, in a
 * prompt too. A tool's own `this.callTool()` stays in-process dispatch, which no surface restricts.
 */

/** Every run of a tool below, with the surface its code saw. */
const runs: Array<{ tool: string; surface: string | null }> = [];

function surfaceTool(name: string, surface: Array<'mcp' | 'agent' | 'job' | 'http-trigger' | 'webmcp'>) {
  @Tool({ name, inputSchema: {}, availableWhen: { surface } })
  class SurfaceTool extends ToolContext {
    async execute() {
      runs.push({ tool: name, surface: getCallSurface() ?? null });
      return { ran: name };
    }
  }
  return SurfaceTool;
}

const McpOnlyTool = surfaceTool('mcp_only', ['mcp']);
const AgentOnlyTool = surfaceTool('agent_only', ['agent']);
const JobOnlyTool = surfaceTool('job_only', ['job']);
const TriggerOnlyTool = surfaceTool('trigger_only', ['http-trigger']);
const WebMcpOnlyTool = surfaceTool('webmcp_only', ['webmcp']);

/** A tool an MCP client calls, whose own code composes with the agent-only tool. */
@Tool({ name: 'compose', inputSchema: {} })
class ComposeTool extends ToolContext {
  async execute() {
    const result = await this.callTool('agent_only', {});
    return { inner: result.isError ? 'refused' : 'ran' };
  }
}

/** Every tool list the agents' model was offered. */
const offered: string[][] = [];

/** A model that calls the tool the input names, then answers with what the tool returned. */
const model = {
  async completion(
    prompt: { messages: Array<{ role: string; content: string | null }> },
    tools?: Array<{ name: string }>,
  ) {
    const last = prompt.messages[prompt.messages.length - 1];
    if (last?.role === 'tool') return { content: String(last.content), finishReason: 'stop' as const };
    offered.push((tools ?? []).map((tool) => tool.name).sort());
    const { tool } = JSON.parse(String(prompt.messages.find((m) => m.role === 'user')?.content ?? '{}')) as {
      tool: string;
    };
    return {
      content: null,
      finishReason: 'tool_calls' as const,
      toolCalls: [{ id: 'call-1', name: tool, arguments: {} }],
    };
  },
};

@Agent({
  name: 'triage',
  inputSchema: { tool: z.string() },
  llm: { adapter: model },
  tools: [McpOnlyTool, AgentOnlyTool],
})
class TriageAgent extends AgentContext {}

@Agent({
  name: 'triage_direct',
  inputSchema: { tool: z.string() },
  llm: { adapter: model },
  tools: [McpOnlyTool, AgentOnlyTool],
  execution: { useToolFlow: false },
})
class TriageDirectAgent extends AgentContext {}

/** Calls the tool its input names, and reports the surface its own code runs on. */
@Job({
  name: 'sync',
  inputSchema: { tool: z.string() },
  outputSchema: { surface: z.string().nullable(), outcome: z.string() },
})
class SyncJob extends JobContext {
  async execute(input: { tool: string }) {
    const surface = getCallSurface() ?? null;
    try {
      const result = await this.callTool(input.tool, {});
      return { surface, outcome: result.isError ? 'refused' : 'ran' };
    } catch {
      return { surface, outcome: 'refused' };
    }
  }
}

@Workflow({
  name: 'sync_mcp_only',
  steps: [{ id: 'sync', jobName: 'sync', input: { tool: 'mcp_only' } }],
})
class SyncMcpOnlyWorkflow {}

@Workflow({
  name: 'sync_job_only',
  steps: [{ id: 'sync', jobName: 'sync', input: { tool: 'job_only' } }],
})
class SyncJobOnlyWorkflow {}

/** Every outcome of the webhook channel's tool calls. */
const triggered: Array<{ tool: string; outcome: string }> = [];

@Channel({ name: 'deploys', source: { type: 'webhook', path: '/hooks/deploy' } })
class DeployChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { tool } = (payload as { body: { tool: string } }).body;
    let outcome: string;
    try {
      outcome = (await this.callTool(tool, {})).isError ? 'refused' : 'ran';
    } catch {
      outcome = 'refused';
    }
    triggered.push({ tool, outcome });
    return { content: `${tool}: ${outcome}` };
  }
}

@Prompt({ name: 'where_am_i', arguments: [] })
class WhereAmIPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: String(getCallSurface() ?? null) } }] };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [McpOnlyTool, AgentOnlyTool, JobOnlyTool, TriggerOnlyTool, WebMcpOnlyTool, ComposeTool],
  agents: [TriageAgent, TriageDirectAgent],
  jobs: [SyncJob],
  workflows: [SyncMcpOnlyWorkflow, SyncJobOnlyWorkflow],
  channels: [DeployChannel],
  prompts: [WhereAmIPrompt],
})
class DeskApp {}

const serverConfig = {
  info: { name: 'internal-surfaces', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
  jobs: { enabled: true },
  channels: { enabled: true },
};

describe('surfaces other than MCP', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect(serverConfig);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    runs.length = 0;
    offered.length = 0;
    triggered.length = 0;
  });

  describe.each(['invoke_triage', 'invoke_triage_direct'])("an agent's model (%s)", (agentTool) => {
    it("is offered only the agent's tools whose surface lists 'agent'", async () => {
      await client.callTool(agentTool, { tool: 'agent_only' });

      expect(offered).toEqual([['agent_only']]);
    });

    it("runs a tool that lists 'agent', on the 'agent' surface", async () => {
      await client.callTool(agentTool, { tool: 'agent_only' });

      expect(runs).toEqual([{ tool: 'agent_only', surface: 'agent' }]);
    });

    it("cannot run a tool whose surface leaves out 'agent'", async () => {
      const result = await client.callTool(agentTool, { tool: 'mcp_only' });

      expect(runs).toEqual([]);
      expect(JSON.stringify(result)).toContain('not found');
    });
  });

  describe('a job', () => {
    it("runs on the 'job' surface, and reaches a tool that lists 'job'", async () => {
      const execution = await client.executeJob('sync', { tool: 'job_only' });

      expect(execution.result).toEqual({ surface: 'job', outcome: 'ran' });
      expect(runs).toEqual([{ tool: 'job_only', surface: 'job' }]);
    });

    it("cannot reach a tool whose surface leaves out 'job'", async () => {
      const execution = await client.executeJob('sync', { tool: 'mcp_only' });

      expect(execution.result).toEqual({ surface: 'job', outcome: 'refused' });
      expect(runs).toEqual([]);
    });

    it('holds for a workflow step', async () => {
      const refused = await client.executeWorkflow('sync_mcp_only');
      const reached = await client.executeWorkflow('sync_job_only');

      const outputsOf = (run: { result?: unknown }) =>
        (run.result as { stepResults?: Record<string, { outputs?: unknown }> } | undefined)?.stepResults?.['sync']
          ?.outputs;
      expect([refused, reached].map(outputsOf)).toEqual([
        { surface: 'job', outcome: 'refused' },
        { surface: 'job', outcome: 'ran' },
      ]);
      expect(runs).toEqual([{ tool: 'job_only', surface: 'job' }]);
    });
  });

  describe('an HTTP trigger', () => {
    let scope: Scope;

    beforeAll(async () => {
      [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes() as Scope[];
    });

    afterAll(async () => {
      await scope.shutdown();
    });

    /** POSTs `{ tool }` to the webhook channel, as its source's HTTP route does. */
    async function deliver(tool: string): Promise<void> {
      const channel = scope.channels?.getChannelInstances().find((instance) => instance.name === 'deploys');
      if (!channel) throw new Error('the deploys channel is not registered');
      const middleware = createWebhookMiddleware(channel, { type: 'webhook', path: '/hooks/deploy' }, scope.logger);
      const res = { status: () => ({ json: () => undefined }) };
      await middleware({ body: { tool }, headers: {}, method: 'POST' }, res);
    }

    it("reaches a tool that lists 'http-trigger', on that surface", async () => {
      await deliver('trigger_only');

      expect({ triggered, runs }).toEqual({
        triggered: [{ tool: 'trigger_only', outcome: 'ran' }],
        runs: [{ tool: 'trigger_only', surface: 'http-trigger' }],
      });
    });

    it("cannot reach a tool whose surface leaves out 'http-trigger'", async () => {
      await deliver('mcp_only');

      expect({ triggered, runs }).toEqual({ triggered: [{ tool: 'mcp_only', outcome: 'refused' }], runs: [] });
    });
  });

  describe('a WebMCP caller', () => {
    let scope: Scope;
    const ctx = { authInfo: { sessionId: 'webmcp:test' }, surface: 'webmcp' as const };

    beforeAll(async () => {
      [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes() as Scope[];
    });

    afterAll(async () => {
      await scope.shutdown();
    });

    function callOnWebMcp(name: string) {
      return scope.runFlowForOutput('tools:call-tool', {
        request: { method: 'tools/call', params: { name, arguments: {} } },
        ctx,
      });
    }

    it("is offered only the tools whose surface lists 'webmcp' (or no surface)", async () => {
      const { tools } = await scope.runFlowForOutput('tools:list-tools', {
        request: { method: 'tools/list', params: {} },
        ctx,
      });

      const names = tools.map((tool) => tool.name);
      expect(names).toContain('webmcp_only');
      expect(names).toContain('compose');
      expect(names).not.toContain('mcp_only');
      expect(names).not.toContain('agent_only');
    });

    it("runs a tool that lists 'webmcp', on the 'webmcp' surface", async () => {
      await callOnWebMcp('webmcp_only');

      expect(runs).toEqual([{ tool: 'webmcp_only', surface: 'webmcp' }]);
    });

    it("cannot run a tool whose surface leaves out 'webmcp'", async () => {
      await expect(callOnWebMcp('mcp_only')).rejects.toThrow(/not found/i);

      expect(runs).toEqual([]);
    });

    it("is out of reach of an MCP client when it lists only 'webmcp'", async () => {
      const tools = (await client.listTools()) as Array<{ name: string }>;

      expect(tools.map((tool) => tool.name)).not.toContain('webmcp_only');
    });
  });

  it('getCallSurface() inside a prompt is the surface of prompts/get', async () => {
    const result = await client.getPrompt('where_am_i', {});

    expect(result.messages[0]?.content).toEqual({ type: 'text', text: 'mcp' });
  });

  it("a tool's own this.callTool() stays unrestricted by surface", async () => {
    const result = await client.callTool('compose', {});

    expect(JSON.stringify(result)).toContain('"inner":"ran"');
    expect(runs).toEqual([{ tool: 'agent_only', surface: null }]);
  });
});
