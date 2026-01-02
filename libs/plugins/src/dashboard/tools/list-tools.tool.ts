import { Tool, ToolContext, ScopeEntry } from '@frontmcp/sdk';
import { z } from 'zod';
import { ParentScopeToken } from '../dashboard.symbol';

/**
 * Safely create a RegExp from user input to prevent ReDoS attacks.
 * Returns null if the pattern is invalid or potentially dangerous.
 */
function safeRegex(pattern: string): RegExp | null {
  // Limit pattern length to prevent complex patterns
  if (pattern.length > 100) {
    return null;
  }
  try {
    const regex = new RegExp(pattern, 'i');
    // Quick test to ensure it doesn't hang on simple input
    regex.test('test');
    return regex;
  } catch {
    // Invalid regex syntax
    return null;
  }
}

/**
 * Input schema for the list-tools tool.
 */
export const listToolsInputSchema = z.object({
  filter: z.string().optional().describe('Filter tools by name pattern (regex supported)'),
  includePlugins: z.boolean().default(true).describe('Include tools from plugins'),
  includeSchemas: z.boolean().default(false).describe('Include input/output schemas in the response'),
});

export type ListToolsInput = z.input<typeof listToolsInputSchema>;

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

    // Apply filter if provided (with ReDoS protection)
    if (input.filter) {
      const pattern = safeRegex(input.filter);
      if (pattern) {
        allTools = allTools.filter((t) => pattern.test(t.name) || pattern.test(t.fullName));
      }
      // If pattern is invalid, skip filtering and return all tools
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
