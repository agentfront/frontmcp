/**
 * useListResources — reactive resource + template list from the ServerRegistry.
 */

import type { ResourceInfo, ResourceTemplateInfo } from '../types';
import { useResolvedServer } from './useResolvedServer';

const EMPTY_RESOURCES: ResourceInfo[] = [];
const EMPTY_TEMPLATES: ResourceTemplateInfo[] = [];

interface ListResourcesOptions {
  server?: string;
}

export interface UseListResourcesResult {
  resources: ResourceInfo[];
  resourceTemplates: ResourceTemplateInfo[];
}

export function useListResources(options?: ListResourcesOptions): UseListResourcesResult {
  const { entry } = useResolvedServer(options?.server);
  return {
    resources: entry?.resources ?? EMPTY_RESOURCES,
    resourceTemplates: entry?.resourceTemplates ?? EMPTY_TEMPLATES,
  };
}
