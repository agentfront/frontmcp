/**
 * useTools — generic hook replacing per-platform hooks.
 *
 * Delegates tool call processing to `processPlatformToolCalls` from
 * `@frontmcp/utils`, making the logic reusable in Node.js backends.
 */

import { useCallback } from 'react';
import { processPlatformToolCalls } from '@frontmcp/utils';
import type { SupportedPlatform, PlatformToolCallsInput, PlatformToolCallsOutput } from '@frontmcp/utils';
import { useAITools } from './useAITools';
import type { PlatformToolsMap } from './types';

export interface UseToolsResult<P extends SupportedPlatform> {
  tools: PlatformToolsMap[P] | null;
  processToolCalls: (calls: PlatformToolCallsInput[P]) => Promise<PlatformToolCallsOutput[P]>;
  loading: boolean;
  error: Error | null;
}

interface ToolsOptions {
  server?: string;
}

export function useTools<P extends SupportedPlatform>(platform: P, options?: ToolsOptions): UseToolsResult<P> {
  const { tools, callTool, loading, error } = useAITools(platform, options);

  const processToolCalls = useCallback(
    (calls: PlatformToolCallsInput[P]) =>
      processPlatformToolCalls(platform, calls as never, callTool) as Promise<PlatformToolCallsOutput[P]>,
    [platform, callTool],
  );

  return { tools, processToolCalls, loading, error };
}
