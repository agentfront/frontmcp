import type { EvalModel, ModelReply, ModelTool, ToolCall, ToolResult } from '../model';
import { runTask, type CallTool, type ToolOutcome } from '../run-task';
import { scriptedModel } from '../scripted-model';

const TOOLS: ModelTool[] = [{ name: 'load_skill', description: 'Loads a skill', inputSchema: { type: 'object' } }];
const USAGE = { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 30, cacheCreationInputTokens: 0 };

/** A model that returns `replies` in order and records what it was sent. */
function replyingModel(replies: ModelReply[]): { model: EvalModel; sent: Array<string | ToolResult[]> } {
  const sent: Array<string | ToolResult[]> = [];
  const model: EvalModel = {
    id: 'replying',
    startConversation: () => ({
      async send(input) {
        sent.push(input);
        const reply = replies[sent.length - 1];
        if (!reply) throw new Error('no reply left');
        return reply;
      },
    }),
  };
  return { model, sent };
}

function toolUse(...toolCalls: ToolCall[]): ModelReply {
  return { text: '', toolCalls, stopReason: 'tool_use', usage: USAGE };
}

const answer = (text: string): ModelReply => ({ text, toolCalls: [], stopReason: 'end_turn', usage: USAGE });

const echoTool: CallTool = async (name, input): Promise<ToolOutcome> => ({
  text: `${name} ${JSON.stringify(input)}`,
  isError: false,
  structuredContent: { name },
});

describe('runTask', () => {
  it('runs each tool call over MCP, sends the results back together, and returns the answer', async () => {
    const { model, sent } = replyingModel([
      toolUse(
        { id: 'a', name: 'load_skill', input: { skillId: 'invoices' } },
        { id: 'b', name: 'load_skill', input: { skillId: 'reports' } },
      ),
      answer('Invoice INV-1001 is open.'),
    ]);

    const transcript = await runTask({
      model,
      system: 'system',
      tools: TOOLS,
      callTool: echoTool,
      prompt: 'status?',
      maxTurns: 5,
    });

    expect(sent).toEqual([
      'status?',
      [
        { callId: 'a', text: 'load_skill {"skillId":"invoices"}', isError: false },
        { callId: 'b', text: 'load_skill {"skillId":"reports"}', isError: false },
      ],
    ]);
    expect(transcript).toMatchObject({
      answer: 'Invoice INV-1001 is open.',
      stopReason: 'end_turn',
      turns: 2,
      usage: { inputTokens: 20, outputTokens: 4, cacheReadInputTokens: 60, cacheCreationInputTokens: 0 },
    });
    expect(transcript.toolCalls.map((record) => [record.name, record.input, record.structuredContent])).toEqual([
      ['load_skill', { skillId: 'invoices' }, { name: 'load_skill' }],
      ['load_skill', { skillId: 'reports' }, { name: 'load_skill' }],
    ]);
    expect(transcript.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('gives the model a failed call as an error result and carries on', async () => {
    const { model, sent } = replyingModel([
      toolUse({ id: 'a', name: 'load_skill', input: {} }),
      answer('The server is down.'),
    ]);
    const unreachable: CallTool = async () => {
      throw new Error('socket hang up');
    };

    const transcript = await runTask({
      model,
      system: '',
      tools: TOOLS,
      callTool: unreachable,
      prompt: 'go',
      maxTurns: 5,
    });

    expect(sent[1]).toEqual([{ callId: 'a', text: 'socket hang up', isError: true }]);
    expect(transcript.toolCalls[0]).toMatchObject({ name: 'load_skill', isError: true, text: 'socket hang up' });
    expect(transcript.answer).toBe('The server is down.');
  });

  it('keeps a thrown value that is not an Error as its text', async () => {
    const { model } = replyingModel([toolUse({ id: 'a', name: 'load_skill', input: {} }), answer('ok')]);
    const throwsText: CallTool = async () => {
      throw 'refused';
    };

    const transcript = await runTask({
      model,
      system: '',
      tools: TOOLS,
      callTool: throwsText,
      prompt: 'go',
      maxTurns: 2,
    });

    expect(transcript.toolCalls[0]?.text).toBe('refused');
  });

  it('stops at the turn limit without an answer', async () => {
    const forever = toolUse({ id: 'a', name: 'load_skill', input: {} });
    const { model, sent } = replyingModel([forever, forever, forever]);

    const transcript = await runTask({
      model,
      system: '',
      tools: TOOLS,
      callTool: echoTool,
      prompt: 'go',
      maxTurns: 2,
    });

    expect(sent).toHaveLength(2);
    expect(transcript).toMatchObject({ answer: '', stopReason: 'turn_limit', turns: 2 });
    expect(transcript.toolCalls).toHaveLength(2);
  });

  it('records a failed model request as an error and stops', async () => {
    const { model } = replyingModel([]);

    const transcript = await runTask({
      model,
      system: '',
      tools: TOOLS,
      callTool: echoTool,
      prompt: 'go',
      maxTurns: 3,
    });

    expect(transcript).toMatchObject({ answer: '', stopReason: 'error', turns: 1, error: 'no reply left' });
  });
});

describe('scriptedModel', () => {
  const script = {
    prompt: 'status?',
    dryRun: { turns: [[{ name: 'load_skill', input: { skillId: 'invoices' } }]], answer: 'open' },
  };

  it('plays the script for the prompt, then answers', async () => {
    const conversation = scriptedModel([script]).startConversation({ system: '', tools: TOOLS });

    const first = await conversation.send('status?');
    const second = await conversation.send([{ callId: first.toolCalls[0]?.id ?? '', text: '{}', isError: false }]);

    expect(first).toMatchObject({
      text: '',
      stopReason: 'tool_use',
      toolCalls: [{ id: 'call_1_0', name: 'load_skill', input: { skillId: 'invoices' } }],
    });
    expect(second).toMatchObject({ text: 'open', stopReason: 'end_turn', toolCalls: [] });
  });

  it('refuses a prompt it has no script for', async () => {
    const conversation = scriptedModel([script]).startConversation({ system: '', tools: TOOLS });

    await expect(conversation.send('something else')).rejects.toThrow('no script for this conversation');
  });
});
