/**
 * useAITools — generic hook that bridges FrontMCP tools to any AI SDK platform.
 *
 * Reads raw MCP tools from the ServerRegistry, formats them via
 * `formatToolsForPlatform()`, and provides a `callTool` handler that
 * executes via `server.callTool()` + `formatResultForPlatform()`.
 *
 * Supports multi-server via `options.server`.
 */

import { useState, useCallback, useEffect } from 'react';
import type { LLMPlatform } from '@frontmcp/sdk';
import { formatToolsForPlatform, formatResultForPlatform } from '@frontmcp/sdk';
import { useResolvedServer } from '../hooks/useResolvedServer';
import type { UseAIToolsResult, PlatformToolsMap, McpToolInfo, FormattedToolResult } from './types';

interface AIToolsOptions {
  server?: string;
}

export function useAITools<P extends LLMPlatform>(platform: P, options?: AIToolsOptions): UseAIToolsResult<P> {
  const { entry } = useResolvedServer(options?.server);

  const server = entry?.server ?? null;
  const toolInfos = entry?.tools ?? [];
  const status = entry?.status ?? 'idle';

  const [formattedTools, setFormattedTools] = useState<PlatformToolsMap[P] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (status !== 'connected' || toolInfos.length === 0) {
      setFormattedTools(null);
      setLoading(status !== 'connected' && status !== 'error');
      return;
    }

    try {
      const mcpTools: McpToolInfo[] = toolInfos
        .filter((t): t is typeof t & { inputSchema: Record<string, unknown> } => t.inputSchema != null)
        .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
      if (mcpTools.length === 0) {
        setFormattedTools(null);
        setLoading(false);
        return;
      }
      const formatted = formatToolsForPlatform(
        mcpTools as Parameters<typeof formatToolsForPlatform>[0],
        platform,
      ) as PlatformToolsMap[P];
      setFormattedTools(formatted);
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
  }, [toolInfos, platform, status]);

  const callTool = useCallback(
    async (name: string, args?: Record<string, unknown>): Promise<FormattedToolResult> => {
      if (!server) {
        throw new Error('FrontMCP server not available');
      }
      try {
        const rawResult = await server.callTool(name, args);
        return formatResultForPlatform(rawResult, platform);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      }
    },
    [server, platform],
  );

  return { tools: formattedTools, callTool, loading, error };
}
