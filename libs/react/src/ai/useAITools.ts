/**
 * useAITools — generic hook that bridges FrontMCP tools to any AI SDK platform.
 *
 * Reads raw MCP tools from the ServerRegistry, formats them via
 * `formatToolsForPlatform()`, and provides a `callTool` handler that
 * executes through the connected client that listed them (`client.callTool()`,
 * with its identity and session) + `formatResultForPlatform()`.
 *
 * Supports multi-server via `options.server`.
 */

import { useCallback, useEffect, useState } from 'react';

import { formatResultForPlatform, formatToolsForPlatform, type LLMPlatform } from '@frontmcp/sdk';

import { useResolvedServer } from '../hooks/useResolvedServer';
import type { FormattedToolResult, McpToolInfo, PlatformToolsMap, UseAIToolsResult } from './types';

interface AIToolsOptions {
  server?: string;
}

export function useAITools<P extends LLMPlatform>(platform: P, options?: AIToolsOptions): UseAIToolsResult<P> {
  const { entry } = useResolvedServer(options?.server);

  const client = entry?.client ?? null;
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
      if (status !== 'connected' || !client) {
        throw new Error('FrontMCP not connected');
      }
      try {
        const rawResult = await client.callTool(name, args);
        return formatResultForPlatform(rawResult as Parameters<typeof formatResultForPlatform>[0], platform);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      }
    },
    [client, status, platform],
  );

  return { tools: formattedTools, callTool, loading, error };
}
