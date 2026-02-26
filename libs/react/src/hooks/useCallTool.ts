/**
 * useCallTool — [callFn, state, reset] tuple for tool invocation.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ToolState, UseCallToolOptions, UseCallToolReturn } from '../types';
import { useFrontMcp } from './useFrontMcp';

export function useCallTool<TInput extends object = Record<string, unknown>, TOutput = unknown>(
  toolName: string,
  options: UseCallToolOptions = {},
): UseCallToolReturn<TInput, TOutput> {
  const { client, status } = useFrontMcp();
  const { onSuccess, onError, resetOnToolChange = true } = options;

  const [state, setState] = useState<ToolState<TOutput>>({
    data: null,
    loading: false,
    error: null,
    called: false,
  });

  useEffect(() => {
    if (resetOnToolChange) {
      setState({ data: null, loading: false, error: null, called: false });
    }
  }, [toolName, resetOnToolChange]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null, called: false });
  }, []);

  const callTool = useCallback(
    async (args: TInput): Promise<TOutput | null> => {
      if (status !== 'connected' || !client) {
        const error = new Error('FrontMCP not connected');
        setState((prev) => ({ ...prev, error, called: true }));
        onError?.(error);
        return null;
      }

      setState((prev) => ({ ...prev, loading: true, error: null, called: true }));

      try {
        const result = await client.callTool(toolName, args as Record<string, unknown>);
        const data = result as TOutput;
        setState({ data, loading: false, error: null, called: true });
        onSuccess?.(data);
        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: null, loading: false, error, called: true });
        onError?.(error);
        return null;
      }
    },
    [client, status, toolName, onSuccess, onError],
  );

  return [callTool, state, reset];
}
