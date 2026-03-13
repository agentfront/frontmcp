/**
 * useStoreResource — Subscribe to a `state://` URI via MCP resource subscriptions.
 *
 * When the server sends `notifications/resources/updated`, the hook re-fetches
 * the resource automatically. This enables live reactive state binding.
 *
 * Supports multi-server via `options.server`.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useResolvedServer } from './useResolvedServer';

interface StoreResourceState {
  data: unknown;
  loading: boolean;
  error: Error | null;
}

interface StoreResourceOptions {
  server?: string;
}

export interface UseStoreResourceReturn extends StoreResourceState {
  refetch: () => void;
}

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

export function useStoreResource(uri: string, options?: StoreResourceOptions): UseStoreResourceReturn {
  const { entry } = useResolvedServer(options?.server);
  const client = entry?.client ?? null;
  const status = entry?.status ?? 'idle';

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

  const fetchRef = useRef(fetchResource);
  fetchRef.current = fetchResource;

  useEffect(() => {
    if (status !== 'connected' || !client) return;
    let cancelled = false;

    setState((prev) => ({ ...prev, loading: true }));
    fetchRef.current();

    let unsubNotification: (() => void) | undefined;

    (async () => {
      try {
        await client.subscribeResource(uri);
      } catch {
        // subscription may not be supported
      }

      if (cancelled) {
        client.unsubscribeResource(uri).catch(() => {});
        return;
      }

      unsubNotification = client.onResourceUpdated((updatedUri: string) => {
        if (updatedUri === uriRef.current) {
          fetchRef.current();
        }
      });
    })();

    return () => {
      cancelled = true;
      unsubNotification?.();
      client.unsubscribeResource(uri).catch(() => {});
    };
  }, [uri, client, status]);

  return {
    ...state,
    refetch: fetchResource,
  };
}
