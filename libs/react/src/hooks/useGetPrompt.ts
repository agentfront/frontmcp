/**
 * useGetPrompt — [fn, state] tuple for prompt fetching.
 */

import { useState, useCallback } from 'react';
import type { PromptState } from '../types';
import { useFrontMcp } from './useFrontMcp';

export type UseGetPromptReturn = [(args?: Record<string, string>) => Promise<unknown>, PromptState];

export function useGetPrompt(promptName: string): UseGetPromptReturn {
  const { client, status } = useFrontMcp();

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
