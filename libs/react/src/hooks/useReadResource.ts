/**
 * useReadResource — dual-mode resource reading.
 *
 * Lazy mode (no URI): `const [read, state] = useReadResource()`
 * Auto-fetch mode:    `const state = useReadResource('app://info')`
 */

import { useState, useCallback, useEffect } from 'react';
import type { ResourceState } from '../types';
import { useFrontMcp } from './useFrontMcp';

type ReadFn = (uri: string) => Promise<unknown>;
type LazyReturn = [ReadFn, ResourceState & { refetch?: undefined }];
type AutoReturn = ResourceState & { refetch: () => void };

export function useReadResource(): LazyReturn;
export function useReadResource(uri: string): AutoReturn;
export function useReadResource(uri?: string): LazyReturn | AutoReturn {
  const { client, status } = useFrontMcp();

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
