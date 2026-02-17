/**
 * useListPrompts — reactive prompt list from provider context.
 */

import type { PromptInfo } from '../types';
import { useFrontMcp } from './useFrontMcp';

export function useListPrompts(): PromptInfo[] {
  const { prompts } = useFrontMcp();
  return prompts;
}
