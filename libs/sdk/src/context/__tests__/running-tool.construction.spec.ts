import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { Agent, AgentContext, App, Tool, ToolContext } from '../../common';
import { getRunningTool } from '../running-tool';

/**
 * A tool runs as itself from the moment it is built, not only once `execute()` starts: work its
 * class starts while it is constructed (a field initializer, a constructor) sees the tool as
 * `getRunningTool()`, so tool-scoped state (Remember's `tool` scope) is keyed by the tool and not
 * by a shared fallback.
 */

const seenAtConstruction: Array<string | undefined> = [];

@Tool({ name: 'probe', inputSchema: {} })
class ProbeTool extends ToolContext {
  private readonly builtAs = getRunningTool()?.fullName;

  async execute() {
    seenAtConstruction.push(this.builtAs);
    return { builtAs: this.builtAs ?? null };
  }
}

/** An LLM that calls `probe` once, then answers with what the tool returned. */
function probeCallingAdapter() {
  return {
    completion: jest.fn(async (prompt: { messages: Array<{ role: string; content: string | null }> }) => {
      const last = prompt.messages[prompt.messages.length - 1];
      if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
      return {
        content: null,
        finishReason: 'tool_calls' as const,
        toolCalls: [{ id: 'call-1', name: 'probe', arguments: {} }],
      };
    }),
  };
}

@Agent({
  name: 'flow_runner',
  description: 'Calls probe through the tool flow',
  inputSchema: {},
  llm: { adapter: probeCallingAdapter() },
  tools: [ProbeTool],
})
class FlowRunnerAgent extends AgentContext {}

@Agent({
  name: 'direct_runner',
  description: 'Calls probe directly',
  inputSchema: {},
  llm: { adapter: probeCallingAdapter() },
  tools: [ProbeTool],
  execution: { useToolFlow: false },
})
class DirectRunnerAgent extends AgentContext {}

@App({ id: 'lab', name: 'Lab', tools: [ProbeTool], agents: [FlowRunnerAgent, DirectRunnerAgent] })
class LabApp {}

describe('getRunningTool() while a tool is constructed', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'running-tool', version: '1.0.0' }, apps: [LabApp] });
  });

  beforeEach(() => {
    seenAtConstruction.length = 0;
  });

  async function call(name: string): Promise<Record<string, unknown> | undefined> {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: {} });
    return message.result as Record<string, unknown> | undefined;
  }

  it('is the tool itself when tools/call builds it', async () => {
    await call('probe');

    expect(seenAtConstruction).toEqual([expect.stringMatching(/:probe$/)]);
  });

  it('is the tool itself when an agent calls it through the tool flow', async () => {
    const result = await call('invoke_flow_runner');

    expect(result?.['isError']).toBeFalsy();
    expect(seenAtConstruction).toEqual([expect.stringMatching(/:probe$/)]);
  });

  it('is the tool itself when an agent runs it directly (useToolFlow: false)', async () => {
    const result = await call('invoke_direct_runner');

    expect(result?.['isError']).toBeFalsy();
    expect(seenAtConstruction).toEqual([expect.stringMatching(/:probe$/)]);
  });
});
