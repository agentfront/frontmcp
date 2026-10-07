import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  Client,
  LoggingMessageNotificationSchema,
  MCP_20260728_META,
  type CallToolResult,
  type Progress,
} from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  Agent,
  AgentContext,
  App,
  LogLevel,
  Provider,
  Tool,
  ToolContext,
  type AgentCompletion,
  type AgentCompletionOptions,
  type AgentPrompt,
  type AgentToolDefinition,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { PublicMcpError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { createInMemoryServer } from '../../transport/in-memory-server';

const seen: Record<string, unknown[]> = {};

function callingModel(label: string, toolName: string, args: Record<string, unknown> = {}) {
  return {
    completion: async (prompt: AgentPrompt, _tools?: AgentToolDefinition[], options?: AgentCompletionOptions) => {
      (seen[`${label}:options`] ??= []).push(options);
      const last = prompt.messages[prompt.messages.length - 1];
      if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
      return {
        content: null,
        finishReason: 'tool_calls' as const,
        toolCalls: [{ id: `${label}-call`, name: toolName, arguments: args }],
      };
    },
  };
}

const answering = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };

@Provider({ name: 'TicketStore' })
class TicketStore {
  readonly tickets = ['T-1', 'T-2'];
}

@Tool({ name: 'list_tickets', inputSchema: {} })
class ListTicketsTool extends ToolContext {
  async execute() {
    return { tickets: this.get(TicketStore).tickets };
  }
}

@Agent({
  name: 'triage',
  inputSchema: {},
  llm: { adapter: callingModel('triage', 'list_tickets') },
  tools: [ListTicketsTool],
})
class TriageAgent extends AgentContext {}

@Tool({ name: 'refuse', inputSchema: {} })
class RefuseTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    this.fail(new PublicMcpError('The ticket is locked'));
  }
}

@Agent({
  name: 'refuser',
  inputSchema: {},
  llm: { adapter: callingModel('refuser', 'refuse') },
  tools: [RefuseTool],
})
class RefuserAgent extends AgentContext {}

@Agent({
  name: 'direct_refuser',
  inputSchema: {},
  llm: { adapter: callingModel('direct_refuser', 'refuse') },
  tools: [RefuseTool],
  execution: { useToolFlow: false },
})
class DirectRefuserAgent extends AgentContext {}

@Agent({ name: 'helper', inputSchema: { note: z.string() }, llm: { adapter: answering } })
class HelperAgent extends AgentContext {
  override async execute(input: { note: string }) {
    return { helped: input.note };
  }
}

@Agent({
  name: 'caller',
  inputSchema: {},
  llm: { adapter: answering },
  agents: [HelperAgent],
  tools: [ListTicketsTool],
})
class CallerAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    const nested = await this.callTool('invoke_helper', { note: 'hi' });
    const own = await this.callTool('list_tickets', {});
    const dotted = await this.callTool('agent:caller.list_tickets', {});
    return { nested: nested.structuredContent, own: own.structuredContent, dotted: dotted.structuredContent };
  }
}

const completionOverrides: string[] = [];

@Agent({
  name: 'overriding',
  inputSchema: {},
  llm: { adapter: callingModel('overriding', 'list_tickets') },
  tools: [ListTicketsTool],
})
class OverridingAgent extends AgentContext {
  protected override async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    completionOverrides.push(`messages:${prompt.messages.length}`);
    return super.completion(prompt, tools, options);
  }
}

@Agent({
  name: 'tuned',
  inputSchema: {},
  llm: { adapter: callingModel('tuned', 'list_tickets') },
  tools: [ListTicketsTool],
})
class TunedAgent extends AgentContext {
  protected override completionOptions(): AgentCompletionOptions {
    return { temperature: 0.2 };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  providers: [TicketStore],
  agents: [TriageAgent, RefuserAgent, DirectRefuserAgent, CallerAgent, OverridingAgent, TunedAgent],
})
class DeskApp {}

describe('agent context wiring', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-context-wiring', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("gives an agent's tools the providers of the agent's app", async () => {
    const result = await server.callTool('invoke_triage', {});

    expect(result.structuredContent).toEqual({ tickets: ['T-1', 'T-2'] });
  });

  it('passes the message of a public error a tool fails with on to the model', async () => {
    const result = await server.callTool('invoke_refuser', {});

    expect(JSON.stringify(result.structuredContent)).toContain('The ticket is locked');
  });

  it('passes that message on when the agent runs its tools directly (useToolFlow: false)', async () => {
    const result = await server.callTool('invoke_direct_refuser', {});

    expect(JSON.stringify(result.structuredContent)).toContain('The ticket is locked');
  });

  it("reaches the agent's nested agents and own tools through this.callTool()", async () => {
    const result = await server.callTool('invoke_caller', {});

    expect(result.structuredContent).toEqual({
      nested: { helped: 'hi' },
      own: { tickets: ['T-1', 'T-2'] },
      dotted: { tickets: ['T-1', 'T-2'] },
    });
  });

  it("runs the loop's completions through an overridden completion()", async () => {
    completionOverrides.length = 0;
    await server.callTool('invoke_overriding', {});

    expect(completionOverrides).toEqual(['messages:1', 'messages:3']);
  });

  it("passes the agent's completion options to every completion", async () => {
    seen['overriding:options'] = [];
    seen['tuned:options'] = [];
    await server.callTool('invoke_overriding', {});
    await server.callTool('invoke_tuned', {});

    expect(seen['overriding:options']).toEqual([{}, {}]);
    expect(seen['tuned:options']).toEqual([{ temperature: 0.2 }, { temperature: 0.2 }]);
  });
});

// ---------------------------------------------------------------- notifications

@Agent({ name: 'herald', inputSchema: {}, llm: { adapter: answering } })
class HeraldAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    const notified = await this.notify('Heralding', 'info');
    const progressed = await this.progress(1, 2, 'Half way');
    return { notified, progressed };
  }
}

@Agent({
  name: 'auto_herald',
  inputSchema: {},
  llm: { adapter: callingModel('auto_herald', 'list_tickets') },
  tools: [ListTicketsTool],
  execution: { enableAutoProgress: true },
})
class AutoHeraldAgent extends AgentContext {}

@Agent({
  name: 'sparse_herald',
  inputSchema: {},
  llm: { adapter: callingModel('sparse_herald', 'list_tickets') },
  tools: [ListTicketsTool],
  execution: { enableAutoProgress: true, notificationInterval: 60_000 },
})
class SparseHeraldAgent extends AgentContext {}

@App({ id: 'hall', name: 'Hall', providers: [TicketStore], agents: [HeraldAgent, AutoHeraldAgent, SparseHeraldAgent] })
class HallApp {}

describe('agent notifications', () => {
  let client: Client;
  let close: () => Promise<void>;
  const messages: unknown[] = [];

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'agent-notifications', version: '1.0.0' },
      apps: [HallApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0] as Scope;
    const inMemory = await createInMemoryServer(scope);
    close = inMemory.close;
    client = new Client({ name: 'spec-client', version: '1.0.0' });
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      messages.push(notification.params);
    });
    await client.connect(inMemory.clientTransport);
    await client.setLoggingLevel('info');
  });

  afterAll(async () => {
    await client.close();
    await close();
  });

  beforeEach(() => {
    messages.length = 0;
  });

  it("sends the agent's own notify() and progress() to the client", async () => {
    const progress: Progress[] = [];
    const result = (await client.callTool({ name: 'invoke_herald', arguments: {} }, undefined, {
      onprogress: (update) => progress.push(update),
    })) as CallToolResult;

    expect(result.structuredContent).toEqual({ notified: true, progressed: true });
    expect(messages).toEqual([expect.objectContaining({ level: 'info', data: { message: 'Heralding' } })]);
    expect(progress).toEqual([expect.objectContaining({ progress: 1, total: 2, message: 'Half way' })]);
  });

  it('sends progress during the run with enableAutoProgress', async () => {
    const progress: Progress[] = [];
    await client.callTool({ name: 'invoke_auto_herald', arguments: {} }, undefined, {
      onprogress: (update) => progress.push(update),
    });

    expect(progress.map((update) => update.message)).toEqual(
      expect.arrayContaining(['Starting LLM call (iteration 1/10)', 'Agent completed']),
    );
  });
});

describe('automatic progress', () => {
  it('sends no more than one update per notificationInterval, and always the last', async () => {
    const fetchServer = await createTestFetchServer({
      info: { name: 'agent-sparse-progress', version: '1.0.0' },
      apps: [HallApp],
    });
    const { notifications } = await rpc20260728(
      fetchServer.handler,
      'tools/call',
      { name: 'invoke_sparse_herald', arguments: {} },
      { meta: { progressToken: 'sparse-1' } },
    );

    expect(notifications.map((notification) => notification.params?.['message'])).toEqual([
      'Starting LLM call (iteration 1/10)',
      'Agent completed',
    ]);
  });
});

describe('agent notifications under MCP 2026-07-28', () => {
  let fetchServer: TestFetchServer;

  beforeAll(async () => {
    fetchServer = await createTestFetchServer({
      info: { name: 'agent-notifications-0728', version: '1.0.0' },
      apps: [HallApp],
    });
  });

  it("sends the agent's own notify() and progress() on the request's stream", async () => {
    const { message, notifications } = await rpc20260728(
      fetchServer.handler,
      'tools/call',
      { name: 'invoke_herald', arguments: {} },
      { meta: { progressToken: 'herald-1', [MCP_20260728_META.logLevel]: 'info' } },
    );

    expect(message.result?.['structuredContent']).toEqual({ notified: true, progressed: true });
    expect(notifications.map((notification) => notification.method)).toEqual([
      'notifications/message',
      'notifications/progress',
    ]);
  });

  it('sends progress during the run with enableAutoProgress', async () => {
    const { notifications } = await rpc20260728(
      fetchServer.handler,
      'tools/call',
      { name: 'invoke_auto_herald', arguments: {} },
      { meta: { progressToken: 'auto-1' } },
    );

    expect(notifications.map((notification) => notification.params?.['message'])).toEqual(
      expect.arrayContaining(['Starting LLM call (iteration 1/10)', 'Agent completed']),
    );
  });
});

// ---------------------------------------------------------------- progress order and failure messages

const twoReadsModel = {
  completion: async (prompt: AgentPrompt) => {
    if (prompt.messages.length > 1) return { content: 'done', finishReason: 'stop' as const };
    const read = (id: string) => ({ id, name: 'list_tickets', arguments: {} });
    return { content: null, finishReason: 'tool_calls' as const, toolCalls: [read('read-1'), read('read-2')] };
  },
};

@Agent({
  name: 'double_reader',
  inputSchema: {},
  llm: { adapter: twoReadsModel },
  tools: [ListTicketsTool],
  execution: { enableAutoProgress: true, notificationInterval: 1 },
})
class DoubleReaderAgent extends AgentContext {}

@Tool({ name: 'read_ledger', inputSchema: {} })
class ReadLedgerTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    throw new Error('connect ECONNREFUSED 10.0.4.7:5432');
  }
}

@Agent({
  name: 'bookkeeper',
  inputSchema: {},
  llm: { adapter: callingModel('bookkeeper', 'read_ledger') },
  tools: [ReadLedgerTool],
})
class BookkeeperAgent extends AgentContext {}

@App({
  id: 'ledger',
  name: 'Ledger',
  providers: [TicketStore],
  agents: [DoubleReaderAgent, BookkeeperAgent, RefuserAgent],
})
class LedgerApp {}

describe('agent progress order and failure messages', () => {
  let fetchServer: TestFetchServer;

  beforeAll(async () => {
    fetchServer = await createTestFetchServer({
      info: { name: 'agent-progress-order', version: '1.0.0' },
      apps: [LedgerApp],
    });
  });

  const logMessages = async (agentTool: string) => {
    const { notifications } = await rpc20260728(
      fetchServer.handler,
      'tools/call',
      { name: agentTool, arguments: {} },
      { meta: { [MCP_20260728_META.logLevel]: 'info' } },
    );
    return notifications
      .filter((notification) => notification.method === 'notifications/message')
      .map((notification) => (notification.params?.['data'] as { message: string }).message);
  };

  it('raises the progress with every update, across tool calls and iterations', async () => {
    // Every clock read is a millisecond later, so the 1 ms notificationInterval lets each update through
    let clock = Date.now();
    const clockSpy = jest.spyOn(Date, 'now').mockImplementation(() => ++clock);
    const { notifications } = await rpc20260728(
      fetchServer.handler,
      'tools/call',
      { name: 'invoke_double_reader', arguments: {} },
      { meta: { progressToken: 'order-1' } },
    ).finally(() => clockSpy.mockRestore());
    const updates = notifications.map((notification) => notification.params as { progress: number; message: string });

    expect(updates.map((update) => update.message)).toEqual([
      'Starting LLM call (iteration 1/10)',
      'LLM response received',
      'Executing tool 1/2: list_tickets',
      'Executing tool 2/2: list_tickets',
      'Starting LLM call (iteration 2/10)',
      'LLM response received',
      'Agent completed',
    ]);
    const values = updates.map((update) => update.progress);
    expect(values.every((value, index) => index === 0 || value > values[index - 1])).toBe(true);
  });

  it("tells the client a tool failed without the error's internal text", async () => {
    const messages = await logMessages('invoke_bookkeeper');

    const failure = messages.find((message) => message.startsWith('Tool read_ledger failed: '));
    expect(failure).toMatch(/^Tool read_ledger failed: Internal FrontMCP error/);
    expect(messages.join('\n')).not.toContain('ECONNREFUSED');
  });

  it("tells the client a public error's message", async () => {
    expect(await logMessages('invoke_refuser')).toContain('Tool refuse failed: The ticket is locked');
  });
});
