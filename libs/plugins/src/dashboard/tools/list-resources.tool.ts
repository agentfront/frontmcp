import { Tool, ToolContext, ScopeEntry } from '@frontmcp/sdk';
import { z } from 'zod';
import { ParentScopeToken } from '../dashboard.symbol';

/**
 * Input schema for the list-resources tool.
 */
export const listResourcesInputSchema = {
  filter: z.string().optional().describe('Filter resources by name or URI pattern (regex supported)'),
  includeTemplates: z.boolean().optional().default(true).describe('Include resource templates in the response'),
};

export type ListResourcesInput = z.infer<z.ZodObject<typeof listResourcesInputSchema>>;

/**
 * Output schema for the list-resources tool.
 */
export const listResourcesOutputSchema = z.object({
  resources: z.array(
    z.object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      isTemplate: z.boolean(),
    }),
  ),
  count: z.number(),
});

export type ListResourcesOutput = z.output<typeof listResourcesOutputSchema>;

/**
 * Tool to list all resources available in the monitored server (parent scope).
 */
@Tool({
  name: 'dashboard:list-resources',
  description: 'List all resources and resource templates registered in the monitored FrontMCP server.',
  inputSchema: listResourcesInputSchema,
  outputSchema: listResourcesOutputSchema,
  annotations: {
    readOnlyHint: true,
  },
})
export default class ListResourcesTool extends ToolContext {
  async execute(input: ListResourcesInput): Promise<ListResourcesOutput> {
    // Try to get parent scope, fall back to current scope
    const parentScope = this.tryGet(ParentScopeToken) as ScopeEntry | undefined;
    const targetScope = parentScope || this.scope;

    const results: ListResourcesOutput['resources'] = [];

    // Get static resources
    try {
      const resources = targetScope.resources?.getResources?.(true) || [];
      for (const resource of resources) {
        results.push({
          name: resource.name || 'unnamed',
          uri: resource.uri || 'unknown',
          description: resource.metadata?.description,
          mimeType: resource.metadata?.mimeType,
          isTemplate: false,
        });
      }
    } catch {
      // Resources registry may not be available
    }

    // Get resource templates
    if (input.includeTemplates) {
      try {
        const templates = targetScope.resources?.getResourceTemplates?.() || [];
        for (const template of templates) {
          results.push({
            name: template.name || 'unnamed',
            uri: template.uriTemplate || 'unknown',
            description: template.metadata?.description,
            mimeType: template.metadata?.mimeType,
            isTemplate: true,
          });
        }
      } catch {
        // Resource templates may not be available
      }
    }

    // Apply filter if provided
    let filtered = results;
    if (input.filter) {
      const pattern = new RegExp(input.filter, 'i');
      filtered = results.filter((r) => pattern.test(r.name) || pattern.test(r.uri));
    }

    return {
      resources: filtered,
      count: filtered.length,
    };
  }
}
