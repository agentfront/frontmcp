import Anthropic from '@anthropic-ai/sdk';

import type { EvalModel, ModelReply, ToolCall, ToolResult } from './model';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

const MAX_TOKENS = 16_000;

export type Effort = NonNullable<Anthropic.OutputConfig['effort']>;

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export interface AnthropicModelOptions {
  model: string;
  /** Left out, the model's default effort applies. */
  effort?: Effort;
  createMessage: CreateMessage;
}

/** Sends each request with a client holding `apiKey`, which it keeps to itself. */
export function anthropicMessageSender(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey });
  return (params) => client.messages.create(params);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toToolResultBlock(result: ToolResult): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: result.callId,
    is_error: result.isError,
    ...(result.text ? { content: result.text } : {}),
  };
}

function toReply(response: Anthropic.Message): ModelReply {
  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  const toolCalls: ToolCall[] =
    response.stop_reason === 'tool_use'
      ? response.content.flatMap((block) =>
          block.type === 'tool_use'
            ? [{ id: block.id, name: block.name, input: isRecord(block.input) ? block.input : {} }]
            : [],
        )
      : [];
  return {
    text,
    toolCalls,
    stopReason: response.stop_reason ?? 'unknown',
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * A Claude model over the Messages API. The history is append-only, each assistant turn kept as the API returned it,
 * and the request is cached up to its last block, so the tools and system prompt every task shares are read from cache.
 */
export function anthropicModel({ model, effort, createMessage }: AnthropicModelOptions): EvalModel {
  return {
    id: model,
    startConversation({ system, tools }) {
      const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: { ...tool.inputSchema, type: 'object' },
      }));
      const messages: Anthropic.MessageParam[] = [];
      return {
        async send(input) {
          messages.push({ role: 'user', content: typeof input === 'string' ? input : input.map(toToolResultBlock) });
          const response = await createMessage({
            model,
            max_tokens: MAX_TOKENS,
            system,
            tools: anthropicTools,
            messages,
            cache_control: { type: 'ephemeral' },
            ...(effort ? { output_config: { effort } } : {}),
          });
          messages.push({ role: 'assistant', content: response.content });
          return toReply(response);
        },
      };
    },
  };
}
