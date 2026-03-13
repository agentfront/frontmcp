/**
 * useListTools — reactive tool list from the ServerRegistry.
 */

import type { ToolInfo } from '../types';
import { useResolvedServer } from './useResolvedServer';

interface ListToolsOptions {
  server?: string;
}

export function useListTools(options?: ListToolsOptions): ToolInfo[] {
  const { entry } = useResolvedServer(options?.server);
  return entry?.tools ?? [];
}
