// file: libs/browser/src/react/hooks/useTool.ts
/**
 * Hook for executing MCP tools.
 *
 * @example
 * ```tsx
 * import { useTool } from '@frontmcp/browser/react';
 *
 * interface SearchInput {
 *   query: string;
 *   limit?: number;
 * }
 *
 * interface SearchOutput {
 *   results: string[];
 *   total: number;
 * }
 *
 * function SearchComponent() {
 *   const { execute, isLoading, error, data } = useTool<SearchInput, SearchOutput>('search');
 *
 *   const handleSearch = async () => {
 *     await execute({ query: 'hello', limit: 10 });
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={handleSearch} disabled={isLoading}>
 *         {isLoading ? 'Searching...' : 'Search'}
 *       </button>
 *       {error && <p>Error: {error.message}</p>}
 *       {data && <p>Found {data.total} results</p>}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback } from 'react';
import { useFrontMcpContext } from '../context';

/**
 * Return type for useTool hook.
 */
export interface UseToolResult<TInput, TOutput> {
  /**
   * Execute the tool with given input.
   */
  execute: (input: TInput) => Promise<TOutput>;

  /**
   * Whether the tool is currently executing.
   */
  isLoading: boolean;

  /**
   * Error from the last execution, if any.
   */
  error: Error | null;

  /**
   * Data from the last successful execution.
   */
  data: TOutput | null;

  /**
   * Reset the state (clear error and data).
   */
  reset: () => void;

  /**
   * Whether the tool is available.
   */
  isAvailable: boolean;
}

/**
 * Hook to execute an MCP tool.
 *
 * @template TInput - The input type for the tool
 * @template TOutput - The output type from the tool
 * @param toolName - The name of the tool to execute
 * @returns Tool execution utilities
 */
export function useTool<TInput = unknown, TOutput = unknown>(toolName: string): UseToolResult<TInput, TOutput> {
  const { callTool, server } = useFrontMcpContext();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TOutput | null>(null);

  const execute = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await callTool<TInput, TOutput>(toolName, input);
        setData(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [callTool, toolName],
  );

  const reset = useCallback(() => {
    setError(null);
    setData(null);
    setIsLoading(false);
  }, []);

  return {
    execute,
    isLoading,
    error,
    data,
    reset,
    isAvailable: server !== null,
  };
}

/**
 * Hook to get information about a specific tool.
 *
 * @param toolName - The name of the tool
 * @returns Tool information or undefined
 */
export function useToolInfo(toolName: string):
  | {
      name: string;
      description?: string;
    }
  | undefined {
  const { listTools } = useFrontMcpContext();
  const tools = listTools();
  return tools.find((t) => t.name === toolName);
}

/**
 * Hook to list all available tools.
 *
 * @returns Array of tool information
 */
export function useToolsList(): { name: string; description?: string }[] {
  const { listTools } = useFrontMcpContext();
  return listTools();
}
