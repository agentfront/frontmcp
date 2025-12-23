// file: libs/browser/src/react/hooks/useResource.ts
/**
 * Hook for reading MCP resources.
 *
 * @example
 * ```tsx
 * import { useResource } from '@frontmcp/browser/react';
 *
 * interface Config {
 *   theme: string;
 *   language: string;
 * }
 *
 * function ConfigDisplay() {
 *   const { data, isLoading, error, refetch } = useResource<Config>('config://app');
 *
 *   if (isLoading) return <p>Loading...</p>;
 *   if (error) return <p>Error: {error.message}</p>;
 *
 *   return (
 *     <div>
 *       <p>Theme: {data?.theme}</p>
 *       <p>Language: {data?.language}</p>
 *       <button onClick={refetch}>Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFrontMcpContext } from '../context';

/**
 * Options for useResource hook.
 */
export interface UseResourceOptions {
  /**
   * Whether to automatically fetch on mount.
   * @default true
   */
  autoFetch?: boolean;

  /**
   * Refetch interval in milliseconds.
   * Set to 0 or undefined to disable.
   */
  refetchInterval?: number;

  /**
   * Whether to refetch when the window regains focus.
   * @default false
   */
  refetchOnFocus?: boolean;
}

/**
 * Return type for useResource hook.
 */
export interface UseResourceResult<T> {
  /**
   * The resource data.
   */
  data: T | null;

  /**
   * Whether the resource is currently loading.
   */
  isLoading: boolean;

  /**
   * Whether the resource has been fetched at least once.
   */
  isFetched: boolean;

  /**
   * Whether the resource is currently refetching.
   */
  isRefetching: boolean;

  /**
   * Error from the last fetch, if any.
   */
  error: Error | null;

  /**
   * Refetch the resource.
   */
  refetch: () => Promise<void>;

  /**
   * Whether the resource is available.
   */
  isAvailable: boolean;
}

/**
 * Hook to read an MCP resource.
 *
 * @template T - The expected data type
 * @param uri - The resource URI to read
 * @param options - Optional configuration
 * @returns Resource data and utilities
 */
export function useResource<T = unknown>(uri: string, options: UseResourceOptions = {}): UseResourceResult<T> {
  const { autoFetch = true, refetchInterval, refetchOnFocus = false } = options;
  const { readResource, server } = useFrontMcpContext();

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(autoFetch);
  const [isFetched, setIsFetched] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const fetchCountRef = useRef(0);

  const fetchResource = useCallback(
    async (isRefetch = false): Promise<void> => {
      const fetchId = ++fetchCountRef.current;

      if (isRefetch) {
        setIsRefetching(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const result = await readResource(uri);

        // Only update if this is the latest fetch and component is mounted
        if (fetchId === fetchCountRef.current && mountedRef.current) {
          // Extract text content from MCP resource response
          let parsedData: T;
          if (
            result &&
            typeof result === 'object' &&
            'contents' in result &&
            Array.isArray((result as { contents: unknown[] }).contents)
          ) {
            const contents = (result as { contents: Array<{ text?: string }> }).contents;
            const text = contents[0]?.text;
            if (text) {
              try {
                parsedData = JSON.parse(text) as T;
              } catch {
                parsedData = text as unknown as T;
              }
            } else {
              parsedData = result as T;
            }
          } else {
            parsedData = result as T;
          }

          setData(parsedData);
          setIsFetched(true);
        }
      } catch (err) {
        if (fetchId === fetchCountRef.current && mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (fetchId === fetchCountRef.current && mountedRef.current) {
          setIsLoading(false);
          setIsRefetching(false);
        }
      }
    },
    [readResource, uri],
  );

  const refetch = useCallback(async (): Promise<void> => {
    await fetchResource(true);
  }, [fetchResource]);

  // Auto-fetch on mount
  useEffect(() => {
    mountedRef.current = true;

    if (autoFetch && server) {
      fetchResource(false);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [autoFetch, fetchResource, server]);

  // Refetch interval
  useEffect(() => {
    if (!refetchInterval || refetchInterval <= 0 || !server) {
      return;
    }

    const intervalId = setInterval(() => {
      if (mountedRef.current) {
        fetchResource(true);
      }
    }, refetchInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [refetchInterval, fetchResource, server]);

  // Refetch on focus
  useEffect(() => {
    if (!refetchOnFocus || !server) {
      return;
    }

    const handleFocus = () => {
      if (mountedRef.current) {
        fetchResource(true);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [refetchOnFocus, fetchResource, server]);

  return {
    data,
    isLoading,
    isFetched,
    isRefetching,
    error,
    refetch,
    isAvailable: server !== null,
  };
}

/**
 * Hook to list all available resources.
 *
 * @returns Array of resource information
 */
export function useResourcesList(): { uri: string; name?: string; description?: string }[] {
  const { listResources } = useFrontMcpContext();
  return listResources();
}
