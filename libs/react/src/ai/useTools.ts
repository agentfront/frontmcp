/**
 * useTools — generic hook replacing per-platform hooks.
 *
 * Delegates tool call processing to `processPlatformToolCalls` from
 * `@frontmcp/utils`, making the logic reusable in Node.js backends.
 */

import { useCallback } from 'react';

import {
  processPlatformToolCalls,
  type CallToolFn,
  type PlatformToolCallsInput,
  type PlatformToolCallsOutput,
  type SupportedPlatform,
} from '@frontmcp/utils';

import type { PlatformToolsMap } from './types';
import { useAITools } from './useAITools';

export interface UseToolsResult<P extends SupportedPlatform> {
  tools: PlatformToolsMap[P] | null;
  processToolCalls: (calls: PlatformToolCallsInput[P]) => Promise<PlatformToolCallsOutput[P]>;
  loading: boolean;
  error: Error | null;
}

export interface ToolsOptions {
  server?: string;
}

/**
 * Generic wrapper type for `processPlatformToolCalls` that accepts a
 * generic platform parameter.  TypeScript overloads cannot be called with
 * an un-narrowed generic, so we express the same contract as an indexed
 * mapped signature instead.
 */
type ProcessToolCallsFn = <P extends SupportedPlatform>(
  platform: P,
  calls: PlatformToolCallsInput[P],
  callTool: CallToolFn,
) => Promise<PlatformToolCallsOutput[P]>;

export function useTools<P extends SupportedPlatform>(platform: P, options?: ToolsOptions): UseToolsResult<P> {
  const { tools, callTool, loading, error } = useAITools(platform, options);

  const processToolCalls = useCallback(
    (calls: PlatformToolCallsInput[P]) => (processPlatformToolCalls as ProcessToolCallsFn)(platform, calls, callTool),
    [platform, callTool],
  );

  return { tools, processToolCalls, loading, error };
}
