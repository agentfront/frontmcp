/**
 * processPlatformToolCalls — generic handler that processes LLM tool calls
 * for any supported platform and returns platform-appropriate responses.
 *
 * Usable from both React hooks and Node.js backends.
 */

import type {
  CallToolFn,
  OpenAIToolCallItem,
  OpenAIToolResponse,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
  VercelToolCallInfo,
  SupportedPlatform,
} from './llm-tool-handler.types';

// ─────────────────────────────────────────────────────────────────────────────
// Overloads for type safety
// ─────────────────────────────────────────────────────────────────────────────

export function processPlatformToolCalls(
  platform: 'openai',
  calls: OpenAIToolCallItem[],
  callTool: CallToolFn,
): Promise<OpenAIToolResponse[]>;
export function processPlatformToolCalls(
  platform: 'claude',
  calls: ClaudeToolUseBlock[],
  callTool: CallToolFn,
): Promise<ClaudeToolResultBlock[]>;
export function processPlatformToolCalls(
  platform: 'vercel-ai',
  calls: VercelToolCallInfo,
  callTool: CallToolFn,
): Promise<unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export async function processPlatformToolCalls(
  platform: SupportedPlatform,
  calls: OpenAIToolCallItem[] | ClaudeToolUseBlock[] | VercelToolCallInfo,
  callTool: CallToolFn,
): Promise<unknown> {
  switch (platform) {
    case 'openai':
      return processOpenAI(calls as OpenAIToolCallItem[], callTool);
    case 'claude':
      return processClaude(calls as ClaudeToolUseBlock[], callTool);
    case 'vercel-ai':
      return processVercel(calls as VercelToolCallInfo, callTool);
    default:
      throw new Error(`Unsupported platform: ${platform as string}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal per-platform helpers
// ─────────────────────────────────────────────────────────────────────────────

async function processOpenAI(toolCalls: OpenAIToolCallItem[], callTool: CallToolFn): Promise<OpenAIToolResponse[]> {
  return Promise.all(
    toolCalls.map(async (tc) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Invalid JSON in tool call arguments for "${tc.function.name}"` }),
        };
      }
      const result = await callTool(tc.function.name, args);
      return {
        role: 'tool' as const,
        tool_call_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      };
    }),
  );
}

async function processClaude(
  toolUseBlocks: ClaudeToolUseBlock[],
  callTool: CallToolFn,
): Promise<ClaudeToolResultBlock[]> {
  return Promise.all(
    toolUseBlocks.map(async (block) => {
      const result = await callTool(block.name, block.input);
      const content = Array.isArray(result)
        ? result.map((c: { text?: string }) => c.text ?? '').join('\n')
        : typeof result === 'string'
          ? result
          : JSON.stringify(result);
      return {
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content,
      };
    }),
  );
}

async function processVercel(info: VercelToolCallInfo, callTool: CallToolFn): Promise<unknown> {
  return callTool(info.toolName, info.args as Record<string, unknown>);
}
