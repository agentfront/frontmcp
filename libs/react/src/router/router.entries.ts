/**
 * createRouterEntries — factory that returns tool/resource entries for easy
 * spreading into `create()` config.
 *
 * The entries are SDK function-style tools/resources, so `create()` accepts
 * them directly.
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

import { z } from '@frontmcp/lazy-zod';
import { resource, tool } from '@frontmcp/sdk';

import { CurrentRouteResource } from './current-route.resource';
import { GoBackTool } from './go-back.tool';
import { NavigateTool } from './navigate.tool';

type ToolEntry = ReturnType<ReturnType<typeof tool>>;
type ResourceEntry = ReturnType<ReturnType<typeof resource>>;

export interface RouterEntries {
  tools: [ToolEntry, ToolEntry];
  resources: [ResourceEntry];
}

export function createRouterEntries(): RouterEntries {
  const navigate = tool({
    name: NavigateTool.toolName,
    description: NavigateTool.description,
    inputSchema: {
      path: z.string().describe('The URL path to navigate to'),
      replace: z.boolean().optional().describe('Replace current history entry instead of pushing'),
    },
  })((input) => NavigateTool.execute(input as { path: string; replace?: boolean }));

  const goBack = tool({
    name: GoBackTool.toolName,
    description: GoBackTool.description,
    inputSchema: {},
  })(() => GoBackTool.execute());

  const currentRoute = resource({
    name: CurrentRouteResource.resourceName,
    uri: CurrentRouteResource.uri,
    description: CurrentRouteResource.description,
    mimeType: 'application/json',
  })(() => CurrentRouteResource.read());

  return { tools: [navigate, goBack], resources: [currentRoute] };
}
