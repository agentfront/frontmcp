/**
 * `execution.enableStreaming` streams the agent model's text (#698): when the request carries a
 * progress token, each chunk goes out as a `notifications/progress` on it (`progress` counts the
 * chunks, `message` holds the chunk). Without a token, or a model that can't stream, the agent runs as
 * it does without the option, and the call's result is the same either way.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { Client, type CallToolResult, type Progress } from '@frontmcp/protocol';

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
  Tool,
  ToolContext,
  type AgentCompletion,
  type AgentCompletionChunk,
  type AgentCompletionOptions,
  type AgentLlmAdapter,
  type AgentPrompt,
  type AgentToolDefinition,
} from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { createInMemoryServer } from '../../transport/in-memory-server';

/** The chunks of one reply, and the completion its stream ends with. */
function reply(chunks: string[], completion?: Partial<AgentCompletion>): AgentCompletionChunk[] {
  const content = chunks.join('');
  return [
    ...chunks.map((chunk) => ({ type: 'content' as const, content: chunk })),
    { type: 'done', completion: { content: content || null, finishReason: 'stop', ...completion } },
  ];
}

const calls: Record<string, string[]> = {};

/**
 * A model that streams `turns[n]` for its n-th reply of a run (a run starts over at the user's
 * message), and answers `completion()` with the same reply in one piece.
 */
function streamingModel(label: string, turns: AgentCompletionChunk[][]): AgentLlmAdapter {
  const turnOf = (prompt: AgentPrompt) => {
    const replies = prompt.messages.filter((message) => message.role === 'tool').length;
    return turns[Math.min(replies, turns.length - 1)];
  };
  return {
    completion: async (prompt) => {
      (calls[label] ??= []).push('completion');
      const done = turnOf(prompt).find((chunk) => chunk.type === 'done');
      return done?.completion ?? { content: null, finishReason: 'stop' };
    },
    streamCompletion: async function* (prompt) {
      (calls[label] ??= []).push('streamCompletion');
      yield* turnOf(prompt);
    },
  };
}

const story = reply(['Once ', 'upon ', 'a time.']);

@Agent({
  name: 'narrator',
  inputSchema: {},
  llm: { adapter: streamingModel('narrator', [story]) },
  execution: { enableStreaming: true },
})
class NarratorAgent extends AgentContext {}

@Agent({
  name: 'forecaster',
  inputSchema: {},
  outputSchema: z.object({ temperature: z.number() }),
  llm: { adapter: streamingModel('forecaster', [reply(['{"temperature":', ' 21}'])]) },
  execution: { enableStreaming: true },
})
class ForecasterAgent extends AgentContext {}

@Agent({
  name: 'vague_forecaster',
  inputSchema: {},
  outputSchema: z.object({ temperature: z.number() }),
  llm: { adapter: streamingModel('vague_forecaster', [reply(['{"temperature":', ' "warm"}'])]) },
  execution: { enableStreaming: true },
})
class VagueForecasterAgent extends AgentContext {}

const lookups: unknown[] = [];

@Tool({ name: 'lookup_tide', inputSchema: { place: z.string() } })
class LookupTideTool extends ToolContext {
  async execute(input: { place: string }) {
    lookups.push(input);
    return { highTide: '12:00' };
  }
}

@Agent({
  name: 'harbormaster',
  inputSchema: {},
  tools: [LookupTideTool],
  llm: {
    adapter: streamingModel('harbormaster', [
      [
        { type: 'content', content: 'Let me check. ' },
        // Announced before its arguments are known, as the OpenAI and Anthropic adapters do
        { type: 'tool_call', toolCall: { id: 'tide-1', name: 'lookup_tide', arguments: {} } },
        {
          type: 'done',
          completion: {
            content: 'Let me check. ',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'tide-1', name: 'lookup_tide', arguments: { place: 'Haifa' } }],
          },
        },
      ],
      reply(['High tide ', 'is at noon.']),
    ]),
  },
  execution: { enableStreaming: true },
})
class HarbormasterAgent extends AgentContext {}

/** An adapter without streamCompletion(): the agent runs unstreamed. */
const completionOnly: AgentLlmAdapter = {
  completion: async () => {
    (calls['plain'] ??= []).push('completion');
    return { content: 'In one piece.', finishReason: 'stop' };
  },
};

@Agent({ name: 'plain', inputSchema: {}, llm: { adapter: completionOnly }, execution: { enableStreaming: true } })
class PlainAgent extends AgentContext {}

@Agent({
  name: 'auto_narrator',
  inputSchema: {},
  llm: { adapter: streamingModel('auto_narrator', [story]) },
  execution: { enableStreaming: true, enableAutoProgress: true, notificationInterval: 1 },
})
class AutoNarratorAgent extends AgentContext {}

const guarded: string[] = [];

/** Overrides completion() only: streaming would bypass it, so the agent runs unstreamed. */
@Agent({
  name: 'guarded',
  inputSchema: {},
  llm: { adapter: streamingModel('guarded', [story]) },
  execution: { enableStreaming: true },
})
class GuardedAgent extends AgentContext {
  protected override async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    guarded.push('completion');
    return super.completion(prompt, tools, options);
  }
}

/** Streams through its own streamCompletion(), though its adapter can't stream. */
@Agent({ name: 'chanter', inputSchema: {}, llm: { adapter: completionOnly }, execution: { enableStreaming: true } })
class ChanterAgent extends AgentContext {
  protected override async *streamCompletion(): AsyncGenerator<AgentCompletionChunk> {
    yield* reply(['La ', 'la.']);
  }
}

@Agent({ name: 'quiet_narrator', inputSchema: {}, llm: { adapter: streamingModel('quiet_narrator', [story]) } })
class QuietNarratorAgent extends AgentContext {}

@Agent({
  name: 'inner_narrator',
  inputSchema: {},
  llm: { adapter: streamingModel('inner_narrator', [story]) },
  execution: { enableStreaming: true },
})
class InnerNarratorAgent extends AgentContext {}

/** Its model calls its nested narrator, whose reply is a tool result, not the client's stream. */
@Agent({
  name: 'storykeeper',
  inputSchema: {},
  agents: [InnerNarratorAgent],
  llm: {
    adapter: streamingModel('storykeeper', [
      [
        {
          type: 'done',
          completion: {
            content: null,
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'story-call', name: 'invoke_inner_narrator', arguments: {} }],
          },
        },
      ],
      reply(['Told.']),
    ]),
  },
  execution: { enableStreaming: true },
})
class StorykeeperAgent extends AgentContext {}

@App({
  id: 'harbor',
  name: 'Harbor',
  agents: [
    NarratorAgent,
    ForecasterAgent,
    VagueForecasterAgent,
    HarbormasterAgent,
    PlainAgent,
    AutoNarratorAgent,
    GuardedAgent,
    ChanterAgent,
    QuietNarratorAgent,
    StorykeeperAgent,
  ],
})
class HarborApp {}

interface ProgressParams {
  progressToken?: string | number;
  progress: number;
  total?: number;
  message?: string;
}

describe('agent streaming under MCP 2026-07-28', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'agent-streaming', version: '1.0.0' }, apps: [HarborApp] });
  });

  beforeEach(() => {
    for (const label of Object.keys(calls)) delete calls[label];
    lookups.length = 0;
  });

  /** The call's result, and the progress notifications it sent. */
  async function call(agent: string, progressToken?: string) {
    const { message, notifications } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: `invoke_${agent}`, arguments: {} },
      progressToken === undefined ? {} : { meta: { progressToken } },
    );
    const progress = notifications
      .filter((notification) => notification.method === 'notifications/progress')
      .map((notification) => notification.params as unknown as ProgressParams);
    return { result: message.result as CallToolResult | undefined, progress };
  }

  it('sends each chunk of the text in order, with a rising progress and no total', async () => {
    const { result, progress } = await call('narrator', 'story-1');

    expect(progress).toEqual([
      { progressToken: 'story-1', progress: 1, message: 'Once ' },
      { progressToken: 'story-1', progress: 2, message: 'upon ' },
      { progressToken: 'story-1', progress: 3, message: 'a time.' },
    ]);
    expect(result?.structuredContent).toEqual({ response: 'Once upon a time.' });
    expect(calls['narrator']).toEqual(['streamCompletion']);
  });

  it('sends nothing, and does not stream, without a progress token', async () => {
    const { progress } = await call('narrator');

    expect(progress).toEqual([]);
    expect(calls['narrator']).toEqual(['completion']);
  });

  it('answers with the same result as an unstreamed run', async () => {
    // The run's duration aside, and the agent's name for an agent without the option
    const withoutDuration = (result: CallToolResult | undefined) => {
      const execution = result?._meta?.['agent/execution'];
      return {
        ...result,
        _meta: {
          ...result?._meta,
          durationMs: 0,
          ...(execution && typeof execution === 'object' ? { 'agent/execution': { ...execution, durationMs: 0 } } : {}),
        },
      };
    };
    const streamed = await call('narrator', 'story-2');
    const unstreamed = await call('narrator');
    const withoutOption = await call('quiet_narrator', 'story-3');

    expect(withoutDuration(streamed.result)).toEqual(withoutDuration(unstreamed.result));
    expect({ ...streamed.result, _meta: undefined }).toEqual({ ...withoutOption.result, _meta: undefined });
    expect(withoutOption.progress).toEqual([]);
    expect(calls['quiet_narrator']).toEqual(['completion']);
  });

  it('streams an agent with an outputSchema and validates its reply once the run completes', async () => {
    const { result, progress } = await call('forecaster', 'weather-1');

    expect(progress.map((update) => update.message)).toEqual(['{"temperature":', ' 21}']);
    expect(result?.structuredContent).toEqual({ temperature: 21 });
  });

  it('fails an agent whose streamed reply does not match its outputSchema, after streaming it', async () => {
    const { result, progress } = await call('vague_forecaster', 'weather-2');

    expect(progress.map((update) => update.message)).toEqual(['{"temperature":', ' "warm"}']);
    expect(result?.isError).toBe(true);
    expect(result?._meta?.['code']).toBe('INVALID_OUTPUT');
  });

  it('runs a tool the model calls mid-stream with its complete arguments, then streams the rest', async () => {
    const { result, progress } = await call('harbormaster', 'tide-1');

    expect(lookups).toEqual([{ place: 'Haifa' }]);
    expect(progress.map((update) => [update.progress, update.message])).toEqual([
      [1, 'Let me check. '],
      [2, 'High tide '],
      [3, 'is at noon.'],
    ]);
    expect(result?.structuredContent).toEqual({ response: 'High tide is at noon.' });
  });

  it('runs unstreamed with an adapter that has no streamCompletion()', async () => {
    const { result, progress } = await call('plain', 'plain-1');

    expect(progress).toEqual([]);
    expect(calls['plain']).toEqual(['completion']);
    expect(result?.structuredContent).toEqual({ response: 'In one piece.' });
  });

  it('sends no automatic progress in a streamed run: its progress notifications carry the text', async () => {
    const { progress } = await call('auto_narrator', 'auto-1');

    expect(progress.map((update) => update.message)).toEqual(['Once ', 'upon ', 'a time.']);
  });

  it('runs unstreamed when the agent class overrides completion() only, so the override sees it', async () => {
    guarded.length = 0;
    const { result, progress } = await call('guarded', 'guarded-1');

    expect(progress).toEqual([]);
    expect(guarded).toEqual(['completion']);
    expect(result?.structuredContent).toEqual({ response: 'Once upon a time.' });
  });

  it("does not stream a nested agent's text: its reply is the calling model's tool result", async () => {
    const { progress } = await call('storykeeper', 'keeper-1');

    expect(progress.map((update) => update.message)).toEqual(['Told.']);
    expect(calls['inner_narrator']).toEqual(['completion']);
  });

  it("streams through the agent class's own streamCompletion()", async () => {
    const { result, progress } = await call('chanter', 'chant-1');

    expect(progress.map((update) => update.message)).toEqual(['La ', 'la.']);
    expect(result?.structuredContent).toEqual({ response: 'La la.' });
  });
});

describe('agent streaming on a session', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'agent-streaming-session', version: '1.0.0' },
      apps: [HarborApp],
      logging: { level: LogLevel.Off },
    });
    const inMemory = await createInMemoryServer(instance.getScopes()[0] as Scope);
    close = inMemory.close;
    client = new Client({ name: 'spec-client', version: '1.0.0' });
    await client.connect(inMemory.clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await close();
  });

  it("sends the chunks as progress notifications on the request's progress token", async () => {
    const progress: Progress[] = [];
    const result = (await client.callTool({ name: 'invoke_narrator', arguments: {} }, undefined, {
      onprogress: (update) => progress.push(update),
    })) as CallToolResult;

    expect(progress).toEqual([
      { progress: 1, message: 'Once ' },
      { progress: 2, message: 'upon ' },
      { progress: 3, message: 'a time.' },
    ]);
    expect(result.structuredContent).toEqual({ response: 'Once upon a time.' });
  });

  it('runs unstreamed for a call without a progress token', async () => {
    delete calls['narrator'];
    const result = (await client.callTool({ name: 'invoke_narrator', arguments: {} })) as CallToolResult;

    expect(calls['narrator']).toEqual(['completion']);
    expect(result.structuredContent).toEqual({ response: 'Once upon a time.' });
  });
});
