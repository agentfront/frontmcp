import { Tool, ToolContext, ScopeEntry } from '@frontmcp/sdk';
import { z } from 'zod';
import { ParentScopeToken } from '../dashboard.symbol';

/**
 * Input schema for the list-tools tool.
 */
export const listToolsInputSchema = {
  filter: z.string().optional().describe('Filter tools by name pattern (regex supported)'),
  includePlugins: z.boolean().optional().default(true).describe('Include tools from plugins'),
  includeSchemas: z.boolean().optional().default(false).describe('Include input/output schemas in the response'),
};

export type ListToolsInput = z.infer<z.ZodObject<typeof listToolsInputSchema>>;

/**
 * Output schema for the list-tools tool.
 */
export const listToolsOutputSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      fullName: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      inputSchema: z.unknown().optional(),
      outputSchema: z.unknown().optional(),
    }),
  ),
  count: z.number(),
});

export type ListToolsOutput = z.output<typeof listToolsOutputSchema>;

/**
 * Tool to list all tools available in the monitored server (parent scope).
 */
@Tool({
  name: 'dashboard:list-tools',
  description:
    'List all tools registered in the monitored FrontMCP server. Returns tool names, descriptions, and optionally schemas.',
  inputSchema: listToolsInputSchema,
  outputSchema: listToolsOutputSchema,
  annotations: {
    readOnlyHint: true,
  },
})
export default class ListToolsTool extends ToolContext {
  async execute(input: ListToolsInput): Promise<ListToolsOutput> {
    // Try to get parent scope, fall back to current scope
    const parentScope = this.tryGet(ParentScopeToken) as ScopeEntry | undefined;
    const targetScope = parentScope || this.scope;

    // Get tools from the target scope
    let allTools: Array<{
      name: string;
      fullName: string;
      metadata?: { description?: string; tags?: string[] };
      inputSchema?: unknown;
      outputSchema?: unknown;
    }> = [];

    try {
      allTools = targetScope.tools?.getTools?.(input.includePlugins ?? true) || [];
    } catch {
      // Tools registry may not be available
    }

    // Apply filter if provided
    if (input.filter) {
      const pattern = new RegExp(input.filter, 'i');
      allTools = allTools.filter((t) => pattern.test(t.name) || pattern.test(t.fullName));
    }

    // Map to output format
    const tools = allTools.map((tool) => ({
      name: tool.name,
      fullName: tool.fullName,
      description: tool.metadata?.description,
      tags: tool.metadata?.tags,
      ...(input.includeSchemas
        ? {
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
          }
        : {}),
    }));

    return {
      tools,
      count: tools.length,
    };
  }
}
