/**
 * useGetPrompt — [fn, state] tuple for prompt fetching.
 *
 * Supports multi-server via `options.server`.
 */

import { useState, useCallback } from 'react';
import type { PromptState } from '../types';
import { useResolvedServer } from './useResolvedServer';

interface GetPromptOptions {
  server?: string;
}

export type UseGetPromptReturn = [(args?: Record<string, string>) => Promise<unknown>, PromptState];

export function useGetPrompt(promptName: string, options?: GetPromptOptions): UseGetPromptReturn {
  const { entry } = useResolvedServer(options?.server);
  const client = entry?.client ?? null;
  const status = entry?.status ?? 'idle';

  const [state, setState] = useState<PromptState>({
    data: null,
    loading: false,
    error: null,
  });

  const getPrompt = useCallback(
    async (args?: Record<string, string>): Promise<unknown> => {
      if (status !== 'connected' || !client) {
        const error = new Error('FrontMCP not connected');
        setState({ data: null, loading: false, error });
        return null;
      }

      setState({ data: null, loading: true, error: null });

      try {
        const result = await client.getPrompt(promptName, args);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: null, loading: false, error });
        return null;
      }
    },
    [client, status, promptName],
  );

  return [getPrompt, state];
}
