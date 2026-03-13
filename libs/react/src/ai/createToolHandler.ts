/**
 * createToolCallHandler — non-React utility for vanilla JS usage.
 */

import type { LLMPlatform, DirectMcpServer } from '@frontmcp/sdk';
import { formatResultForPlatform } from '@frontmcp/sdk';
import type { CallToolFn } from '@frontmcp/utils';
import type { FormattedToolResult } from './types';

export interface ToolCallHandler {
  callTool: CallToolFn;
}

export function createToolCallHandler(server: DirectMcpServer, platform: LLMPlatform): ToolCallHandler {
  return {
    callTool: async (name: string, args?: Record<string, unknown>): Promise<FormattedToolResult> => {
      const rawResult = await server.callTool(name, args);
      return formatResultForPlatform(rawResult, platform);
    },
  };
}
