/**
 * createRouterEntries — factory that returns tool/resource entries for easy
 * spreading into `create()` config.
 *
 * @example
 * ```ts
 * const { tools, resources } = createRouterEntries();
 * const server = await create({
 *   info: { name: 'app', version: '1.0.0' },
 *   tools: [...tools, ...myTools],
 *   resources: [...resources, ...myResources],
 * });
 * ```
 */

import { NavigateTool } from './navigate.tool';
import { GoBackTool } from './go-back.tool';
import { CurrentRouteResource } from './current-route.resource';

export interface RouterEntries {
  tools: [typeof NavigateTool, typeof GoBackTool];
  resources: [typeof CurrentRouteResource];
}

export function createRouterEntries(): RouterEntries {
  return {
    tools: [NavigateTool, GoBackTool],
    resources: [CurrentRouteResource],
  };
}
