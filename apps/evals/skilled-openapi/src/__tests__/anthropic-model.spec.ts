import type Anthropic from '@anthropic-ai/sdk';

import {
  anthropicMessageSender,
  anthropicModel,
  DEFAULT_ANTHROPIC_MODEL,
  type CreateMessage,
} from '../anthropic-model';
import type { ModelTool } from '../model';

const TOOLS: ModelTool[] = [
  {
    name: 'load_skill',
    description: 'Loads a skill',
    inputSchema: { type: 'object', properties: { skillId: { type: 'string' } }, required: ['skillId'] },
  },
];

function message(
  content: unknown[],
  stopReason: Anthropic.StopReason | null,
  usage: Partial<Anthropic.Usage> = {},
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      ...usage,
    },
  } as Anthropic.Message;
}

/** Answers with `responses` in order and keeps a copy of each request as it was sent. */
function fakeApi(responses: Anthropic.Message[]): {
  createMessage: CreateMessage;
  requests: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createMessage: CreateMessage = async (params) => {
    requests.push(structuredClone(params));
    const response = responses[requests.length - 1];
    if (!response) throw new Error('no response left');
    return response;
  };
  return { createMessage, requests };
}

const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'load_skill', input: { skillId: 'invoices' } };

describe('anthropicModel', () => {
  it('sends the system prompt, the tools and the prompt, cached, and returns the tool calls', async () => {
    const api = fakeApi([
      message([thinking, { type: 'text', text: 'Loading.' }, toolUse], 'tool_use', {
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 7,
      }),
    ]);
    const conversation = anthropicModel({
      model: 'claude-sonnet-5-5',
      createMessage: api.createMessage,
    }).startConversation({
      system: 'You are connected to billing.',
      tools: TOOLS,
    });

    const reply = await conversation.send('Status of INV-1001?');

    expect(api.requests).toEqual([
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 16_000,
        system: 'You are connected to billing.',
        tools: [
          {
            name: 'load_skill',
            description: 'Loads a skill',
            input_schema: { type: 'object', properties: { skillId: { type: 'string' } }, required: ['skillId'] },
          },
        ],
        messages: [{ role: 'user', content: 'Status of INV-1001?' }],
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(reply).toEqual({
      text: 'Loading.',
      toolCalls: [{ id: 'toolu_1', name: 'load_skill', input: { skillId: 'invoices' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 40, cacheCreationInputTokens: 7 },
    });
  });

  it('keeps the history append-only, each assistant turn as the API returned it, and sends the effort', async () => {
    const firstTurn = message([thinking, toolUse], 'tool_use');
    const api = fakeApi([firstTurn, message([{ type: 'text', text: 'It is open.' }], 'end_turn')]);
    const conversation = anthropicModel({
      model: 'm',
      effort: 'low',
      createMessage: api.createMessage,
    }).startConversation({
      system: 's',
      tools: TOOLS,
    });

    await conversation.send('Status?');
    const reply = await conversation.send([
      { callId: 'toolu_1', text: '{"skill":{"id":"invoices"}}', isError: false },
      { callId: 'toolu_2', text: '', isError: true },
    ]);

    expect(api.requests[1]?.output_config).toEqual({ effort: 'low' });
    expect(api.requests[1]?.messages).toEqual([
      { role: 'user', content: 'Status?' },
      { role: 'assistant', content: firstTurn.content },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: '{"skill":{"id":"invoices"}}' },
          { type: 'tool_result', tool_use_id: 'toolu_2', is_error: true },
        ],
      },
    ]);
    expect(reply).toMatchObject({ text: 'It is open.', toolCalls: [], stopReason: 'end_turn' });
  });

  it('runs no tool call from a reply that was cut off', async () => {
    const api = fakeApi([message([toolUse], 'max_tokens')]);
    const conversation = anthropicModel({ model: 'm', createMessage: api.createMessage }).startConversation({
      system: 's',
      tools: [],
    });

    expect(await conversation.send('go')).toMatchObject({ toolCalls: [], stopReason: 'max_tokens' });
  });

  it('gives a tool input that is not an object as an empty input, and a missing stop reason as unknown', async () => {
    const api = fakeApi([
      message([{ ...toolUse, input: 'invoices' }], 'tool_use'),
      message([{ type: 'text', text: 'done' }], null),
    ]);
    const conversation = anthropicModel({ model: 'm', createMessage: api.createMessage }).startConversation({
      system: 's',
      tools: [],
    });

    expect((await conversation.send('go')).toolCalls).toEqual([{ id: 'toolu_1', name: 'load_skill', input: {} }]);
    expect((await conversation.send([])).stopReason).toBe('unknown');
  });
});

describe('anthropicMessageSender', () => {
  it('builds a sender without sending anything', () => {
    expect(typeof anthropicMessageSender('placeholder-key-for-a-test')).toBe('function');
  });
});
