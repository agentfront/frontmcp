/**
 * useStoreResource — Subscribe to a `state://` URI via MCP resource subscriptions.
 *
 * When the server sends `notifications/resources/updated`, the hook re-fetches
 * the resource automatically. This enables live reactive state binding.
 *
 * @example
 * ```tsx
 * function CounterDisplay() {
 *   const { data, loading, error, refetch } = useStoreResource('state://counter');
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   return <pre>{JSON.stringify(data, null, 2)}</pre>;
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFrontMcp } from './useFrontMcp';

interface StoreResourceState {
  data: unknown;
  loading: boolean;
  error: Error | null;
}

export interface UseStoreResourceReturn extends StoreResourceState {
  refetch: () => void;
}

/**
 * Parse the text content from an MCP ReadResourceResult.
 */
function parseResourceContent(result: unknown): unknown {
  const r = result as { contents?: Array<{ text?: string }> };
  if (r?.contents?.[0]?.text) {
    try {
      return JSON.parse(r.contents[0].text);
    } catch {
      return r.contents[0].text;
    }
  }
  return result;
}

export function useStoreResource(uri: string): UseStoreResourceReturn {
  const { client, status } = useFrontMcp();
  const [state, setState] = useState<StoreResourceState>({ data: null, loading: true, error: null });
  const uriRef = useRef(uri);
  uriRef.current = uri;

  const fetchResource = useCallback(async () => {
    if (status !== 'connected' || !client) return;
    try {
      const result = await client.readResource(uri);
      setState({ data: parseResourceContent(result), loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: err instanceof Error ? err : new Error(String(err)) });
    }
  }, [uri, client, status]);

  useEffect(() => {
    if (status !== 'connected' || !client) return;
    let cancelled = false;

    // Initial fetch
    setState((prev) => ({ ...prev, loading: true }));
    fetchResource();

    // Subscribe to updates
    let unsubNotification: (() => void) | undefined;

    (async () => {
      try {
        await client.subscribeResource(uri);
      } catch {
        // subscription may not be supported — still works with manual refetch
      }

      if (cancelled) {
        client.unsubscribeResource(uri).catch(() => {});
        return;
      }

      unsubNotification = client.onResourceUpdated((updatedUri: string) => {
        if (updatedUri === uriRef.current) {
          fetchResource();
        }
      });
    })();

    return () => {
      cancelled = true;
      unsubNotification?.();
      client.unsubscribeResource(uri).catch(() => {});
    };
  }, [uri, client, status, fetchResource]);

  return {
    ...state,
    refetch: fetchResource,
  };
}
