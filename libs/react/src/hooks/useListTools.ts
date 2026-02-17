/**
 * useListTools — reactive tool list from provider context.
 */

import type { ToolInfo } from '../types';
import { useFrontMcp } from './useFrontMcp';

export function useListTools(): ToolInfo[] {
  const { tools } = useFrontMcp();
  return tools;
}
