/**
 * useListResources — reactive resource + template list from provider context.
 */

import type { ResourceInfo, ResourceTemplateInfo } from '../types';
import { useFrontMcp } from './useFrontMcp';

export interface UseListResourcesResult {
  resources: ResourceInfo[];
  resourceTemplates: ResourceTemplateInfo[];
}

export function useListResources(): UseListResourcesResult {
  const { resources, resourceTemplates } = useFrontMcp();
  return { resources, resourceTemplates };
}
