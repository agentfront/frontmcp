import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { GraphDataProvider } from '../providers';
import type { GraphData } from '../shared/types';

/**
 * Input schema for the graph tool.
 */
export const graphToolInputSchema = {
  includeSchemas: z.boolean().optional().default(false).describe('Include full input/output schemas in the response'),
  refresh: z.boolean().optional().default(false).describe('Force refresh the graph data (bypass cache)'),
};

export type GraphToolInput = z.infer<z.ZodObject<typeof graphToolInputSchema>>;

/**
 * Tool to get the server graph showing all tools, resources, prompts, and their relationships.
 */
@Tool({
  name: 'dashboard:graph',
  description:
    'Get the server graph showing all registered tools, resources, prompts, apps, and their relationships. Returns nodes and edges that can be visualized.',
  inputSchema: graphToolInputSchema,
  annotations: {
    readOnlyHint: true,
  },
})
export default class GraphTool extends ToolContext {
  async execute(input: GraphToolInput): Promise<GraphData> {
    const graphProvider = this.get(GraphDataProvider);

    // Force refresh if requested
    if (input.refresh) {
      graphProvider.invalidateCache();
    }

    const graphData = await graphProvider.getGraphData();

    // Optionally strip schemas to reduce response size
    if (!input.includeSchemas) {
      return {
        ...graphData,
        nodes: graphData.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            inputSchema: undefined,
            outputSchema: undefined,
          },
        })),
      };
    }

    return graphData;
  }
}
