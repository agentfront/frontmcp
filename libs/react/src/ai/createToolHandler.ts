/**
 * createToolCallHandler — non-React utility for vanilla JS usage.
 *
 * Usage:
 * ```ts
 * const server = await create({ info: { name: 'demo', version: '1.0.0' }, tools: [...] });
 * const { callTool } = createToolCallHandler(server, 'openai');
 * const result = await callTool('greet', { name: 'World' });
 * ```
 */

import type { LLMPlatform, DirectMcpServer } from '@frontmcp/sdk';
import { formatResultForPlatform } from '@frontmcp/sdk';
import type { FormattedToolResult } from './types';

export interface ToolCallHandler {
  callTool: (name: string, args?: Record<string, unknown>) => Promise<FormattedToolResult>;
}

export function createToolCallHandler(server: DirectMcpServer, platform: LLMPlatform): ToolCallHandler {
  return {
    callTool: async (name: string, args?: Record<string, unknown>): Promise<FormattedToolResult> => {
      const rawResult = await server.callTool(name, args);
      return formatResultForPlatform(rawResult, platform);
    },
  };
}
