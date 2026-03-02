/**
 * useVercelAI — tools + onToolCall for Vercel AI SDK `useChat()`.
 *
 * Usage:
 * ```tsx
 * const { tools, onToolCall } = useVercelAI();
 * const { messages } = useChat({ body: { tools }, onToolCall });
 * ```
 */

import { useCallback } from 'react';
import { useAITools } from './useAITools';
import type { UseVercelAIResult, VercelToolCallInfo } from './types';

export function useVercelAI(): UseVercelAIResult {
  const { tools, callTool, loading, error } = useAITools('vercel-ai');

  const onToolCall = useCallback(
    async (info: VercelToolCallInfo): Promise<unknown> => {
      return callTool(info.toolName, info.args as Record<string, unknown>);
    },
    [callTool],
  );

  return { tools, onToolCall, loading, error };
}
