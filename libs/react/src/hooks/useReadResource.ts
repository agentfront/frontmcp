/**
 * useReadResource — dual-mode resource reading.
 *
 * Lazy mode (no URI): `const [read, state] = useReadResource()`
 * Auto-fetch mode:    `const state = useReadResource('app://info')`
 *
 * Supports multi-server via `options.server`.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ResourceState } from '../types';
import { useResolvedServer } from './useResolvedServer';

interface ReadResourceOptions {
  server?: string;
}

type ReadFn = (uri: string) => Promise<unknown>;
type LazyReturn = [ReadFn, ResourceState & { refetch?: undefined }];
type AutoReturn = ResourceState & { refetch: () => void };

export function useReadResource(options?: ReadResourceOptions): LazyReturn;
export function useReadResource(uri: string, options?: ReadResourceOptions): AutoReturn;
export function useReadResource(
  uriOrOptions?: string | ReadResourceOptions,
  maybeOptions?: ReadResourceOptions,
): LazyReturn | AutoReturn {
  const uri = typeof uriOrOptions === 'string' ? uriOrOptions : undefined;
  const options = typeof uriOrOptions === 'object' ? uriOrOptions : maybeOptions;
  const serverName = options?.server;

  const { entry } = useResolvedServer(serverName);
  const client = entry?.client ?? null;
  const status = entry?.status ?? 'idle';

  const [state, setState] = useState<ResourceState>({
    data: null,
    loading: false,
    error: null,
  });

  const read = useCallback(
    async (targetUri: string): Promise<unknown> => {
      if (status !== 'connected' || !client) {
        const error = new Error('FrontMCP not connected');
        setState({ data: null, loading: false, error });
        return null;
      }

      setState({ data: null, loading: true, error: null });

      try {
        const result = await client.readResource(targetUri);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: null, loading: false, error });
        return null;
      }
    },
    [client, status],
  );

  // Auto-fetch mode
  useEffect(() => {
    if (uri && status === 'connected' && client) {
      read(uri);
    }
  }, [uri, status, client, read]);

  if (uri !== undefined) {
    return {
      ...state,
      refetch: () => {
        read(uri);
      },
    };
  }

  return [read, state];
}
