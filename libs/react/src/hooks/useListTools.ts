/**
 * useListTools — reactive tool list from the ServerRegistry.
 */

import type { ToolInfo } from '../types';
import { useResolvedServer } from './useResolvedServer';

const EMPTY_TOOLS: ToolInfo[] = [];

interface ListToolsOptions {
  server?: string;
}

export function useListTools(options?: ListToolsOptions): ToolInfo[] {
  const { entry } = useResolvedServer(options?.server);
  return entry?.tools ?? EMPTY_TOOLS;
}
