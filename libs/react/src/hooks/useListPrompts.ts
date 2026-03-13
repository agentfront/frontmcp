/**
 * useListPrompts — reactive prompt list from the ServerRegistry.
 */

import type { PromptInfo } from '../types';
import { useResolvedServer } from './useResolvedServer';

interface ListPromptsOptions {
  server?: string;
}

export function useListPrompts(options?: ListPromptsOptions): PromptInfo[] {
  const { entry } = useResolvedServer(options?.server);
  return entry?.prompts ?? [];
}
