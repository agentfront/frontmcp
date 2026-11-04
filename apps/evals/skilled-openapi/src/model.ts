/** A tool the MCP server lists, as the model is given it. */
export interface ModelTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** What a tool call answered, sent back to the model in the next turn. */
export interface ToolResult {
  callId: string;
  text: string;
  isError: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ModelReply {
  text: string;
  /** The tools the model asks to run before it answers; empty once it has answered. */
  toolCalls: ToolCall[];
  /** Why the model stopped, in the provider's own words. */
  stopReason: string;
  usage: TokenUsage;
}

/** One conversation, whose history the model adapter keeps in its provider's own format. */
export interface ModelConversation {
  send(input: string | ToolResult[]): Promise<ModelReply>;
}

/** A model the harness runs tasks with. Another provider is added by implementing this. */
export interface EvalModel {
  readonly id: string;
  startConversation(setup: { system: string; tools: ModelTool[] }): ModelConversation;
}

export const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

export function addUsage(total: TokenUsage, more: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + more.inputTokens,
    outputTokens: total.outputTokens + more.outputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens + more.cacheReadInputTokens,
    cacheCreationInputTokens: total.cacheCreationInputTokens + more.cacheCreationInputTokens,
  };
}
