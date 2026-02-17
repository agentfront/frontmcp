/**
 * useOpenAITools — tools + handleToolCalls for OpenAI SDK / OpenRouter.
 *
 * Usage:
 * ```tsx
 * const { tools, handleToolCalls } = useOpenAITools();
 * const response = await openai.chat.completions.create({ tools, messages });
 * if (response.choices[0].message.tool_calls?.length) {
 *   const toolMessages = await handleToolCalls(response.choices[0].message.tool_calls);
 * }
 * ```
 */

import { useCallback } from 'react';
import { useAITools } from './useAITools';
import type { UseOpenAIToolsResult, OpenAIToolCallItem } from './types';

export function useOpenAITools(): UseOpenAIToolsResult {
  const { tools, callTool, loading, error } = useAITools('openai');

  const handleToolCalls = useCallback(
    async (
      toolCalls: OpenAIToolCallItem[],
    ): Promise<Array<{ role: 'tool'; tool_call_id: string; content: string }>> => {
      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const result = await callTool(tc.function.name, args);
          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          };
        }),
      );
      return results;
    },
    [callTool],
  );

  return { tools, handleToolCalls, loading, error };
}
