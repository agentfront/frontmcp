import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, type ScopeEntry } from '@frontmcp/sdk';

import { assertDashboardToolAccess } from '../auth/dashboard-access';
import { ParentScopeToken } from '../dashboard.symbol';
import { containsText } from '../shared/name-filter';

/**
 * Input schema for the list-tools tool.
 */
export const listToolsInputSchema = {
  filter: z.string().optional().describe('Only tools whose name contains this text, ignoring case'),
  includePlugins: z.boolean().default(true).describe('Include tools from plugins'),
  includeSchemas: z.boolean().default(false).describe('Include input/output schemas in the response'),
};

export type ListToolsInput = z.output<z.ZodObject<typeof listToolsInputSchema>>;

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
    assertDashboardToolAccess(this);

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

    if (input.filter) {
      const matches = containsText(input.filter);
      allTools = allTools.filter((t) => matches(t.name) || matches(t.fullName));
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
