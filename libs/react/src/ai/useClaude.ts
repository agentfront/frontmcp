/**
 * useClaudeTools — tools + handleToolUse for Anthropic Claude SDK.
 *
 * Usage:
 * ```tsx
 * const { tools, handleToolUse } = useClaudeTools();
 * const response = await anthropic.messages.create({ tools, messages });
 * const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
 * if (toolUseBlocks.length) {
 *   const toolResults = await handleToolUse(toolUseBlocks);
 * }
 * ```
 */

import { useCallback } from 'react';
import { useAITools } from './useAITools';
import type { UseClaudeToolsResult, ClaudeToolUseBlock } from './types';

export function useClaudeTools(): UseClaudeToolsResult {
  const { tools, callTool, loading, error } = useAITools('claude');

  const handleToolUse = useCallback(
    async (
      toolUseBlocks: ClaudeToolUseBlock[],
    ): Promise<Array<{ type: 'tool_result'; tool_use_id: string; content: string }>> => {
      const results = await Promise.all(
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
      return results;
    },
    [callTool],
  );

  return { tools, handleToolUse, loading, error };
}
