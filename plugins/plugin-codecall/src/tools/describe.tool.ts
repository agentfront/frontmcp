// file: libs/plugins/src/codecall/tools/describe.tool.ts
import { Tool, ToolContext, ToolEntry } from '@frontmcp/sdk';
import type { JSONSchema } from 'zod/v4/core';
import { toJSONSchema } from 'zod/v4';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import { z, ZodType } from 'zod';
import {
  DescribeToolInput,
  describeToolInputSchema,
  DescribeToolOutput,
  describeToolOutputSchema,
  describeToolDescription,
} from './describe.schema';
import { generateSmartExample } from '../utils';
import { isBlockedSelfReference } from '../security';

@Tool({
  name: 'codecall:describe',
  cache: {
    ttl: 60, // 1 minute
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: describeToolDescription,
  inputSchema: describeToolInputSchema,
  outputSchema: describeToolOutputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
})
export default class DescribeTool extends ToolContext {
  async execute(input: DescribeToolInput): Promise<DescribeToolOutput> {
    const { toolNames } = input;

    const tools: DescribeToolOutput['tools'] = [];
    const notFound: string[] = [];

    // Get all available tools from the registry
    const allTools = this.scope.tools.getTools(true);
    const toolMap = new Map(allTools.map((t) => [t.name, t]));
    const fullNameMap = new Map(allTools.map((t) => [t.fullName, t]));

    for (const toolName of toolNames) {
      // Security: Don't allow describing CodeCall tools themselves
      if (isBlockedSelfReference(toolName)) {
        notFound.push(toolName);
        continue;
      }

      // Find the tool by name or fullName
      const tool = toolMap.get(toolName) || fullNameMap.get(toolName);

      if (!tool) {
        notFound.push(toolName);
        continue;
      }

      // Extract app ID from tool owner or metadata
      const appId = this.extractAppId(tool);

      // Get input schema - convert from Zod to ensure descriptions are included
      const inputSchema = this.getInputSchema(tool);

      // Get output schema - convert from Zod if needed
      const outputSchema = this.toJsonSchema(tool.outputSchema);

      // Generate usage examples: user-provided > smart generation > basic fallback
      const usageExamples = this.generateExamples(tool, inputSchema ?? undefined);

      tools.push({
        name: tool.name,
        appId,
        description: tool.metadata?.description || `Tool: ${tool.name}`,
        inputSchema: (inputSchema as Record<string, unknown>) || null,
        outputSchema: (outputSchema as Record<string, unknown>) || null,
        annotations: tool.metadata?.annotations,
        usageExamples,
      });
    }

    return {
      tools,
      notFound: notFound.length > 0 ? notFound : undefined,
    };
  }

  /**
   * Get the input schema for a tool, converting from Zod to JSON Schema.
   * This ensures that property descriptions from .describe() are included.
   *
   * Priority:
   * 1. Convert from tool.inputSchema (Zod) to get descriptions
   * 2. Fall back to rawInputSchema if conversion fails
   * 3. Return null if no schema available
   */
  private getInputSchema(tool: ToolEntry<any, any>): JsonSchema | null {
    // First, try to convert from the Zod inputSchema to ensure descriptions are included
    if (tool.inputSchema && typeof tool.inputSchema === 'object' && Object.keys(tool.inputSchema).length > 0) {
      try {
        // tool.inputSchema is a ZodRawShape (Record<string, ZodType>)
        const firstValue = Object.values(tool.inputSchema)[0];
        if (firstValue instanceof ZodType) {
          // Convert Zod shape to JSON Schema - this preserves .describe() annotations
          return toJSONSchema(z.object(tool.inputSchema as Record<string, ZodType>)) as JsonSchema;
        }
      } catch {
        // Fall through to rawInputSchema
      }
    }

    // Fall back to rawInputSchema if available
    if (tool.rawInputSchema) {
      return tool.rawInputSchema as JsonSchema;
    }

    return null;
  }

  /**
   * Convert a schema to JSON Schema format.
   * Handles Zod schemas, raw shapes, and already-JSON-Schema objects.
   *
   * Uses Zod v4's built-in z.toJSONSchema() for conversion.
   */
  private toJsonSchema(schema: unknown): JsonSchema | null {
    if (!schema) {
      return null;
    }

    // Check if it's a Zod schema
    if (schema instanceof ZodType) {
      try {
        // Use Zod v4's toJSONSchema conversion
        return toJSONSchema(schema);
      } catch {
        // If conversion fails, return null
        return null;
      }
    }

    // Check if it's a raw Zod shape (Record<string, ZodTypeAny>)
    if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
      const obj = schema as Record<string, unknown>;
      const firstValue = Object.values(obj)[0];

      // If the first value is a ZodType, treat the whole thing as a raw shape
      if (firstValue instanceof ZodType) {
        try {
          // Wrap in z.object and convert using Zod v4's toJSONSchema
          return toJSONSchema(z.object(obj as Record<string, ZodType>) as any) as JsonSchema;
        } catch {
          return null;
        }
      }

      // Already a JSON Schema object
      if ('type' in obj || 'properties' in obj || '$schema' in obj) {
        return schema as JsonSchema;
      }
    }

    // String literal output schemas (like 'text', 'json', etc.) - not a JSON Schema
    if (typeof schema === 'string') {
      return null;
    }

    // Array output schemas - not directly convertible
    if (Array.isArray(schema)) {
      return null;
    }

    return null;
  }

  /**
   * Extract app ID from tool metadata or owner.
   */
  private extractAppId(tool: {
    name?: string;
    metadata?: { codecall?: { appId?: string }; source?: string };
    owner?: { id?: string };
  }): string {
    // Check codecall metadata first
    if (tool.metadata?.codecall?.appId) {
      return tool.metadata.codecall.appId;
    }

    // Check source metadata
    if (tool.metadata?.source) {
      return tool.metadata.source;
    }

    // Check owner
    if (tool.owner?.id) {
      return tool.owner.id;
    }

    // Extract from tool name (namespace:name -> namespace)
    const nameParts = tool.name?.split(':');
    if (nameParts && nameParts.length > 1) {
      return nameParts[0];
    }

    return 'unknown';
  }

  /**
   * Generate up to 5 usage examples for a tool.
   *
   * Priority:
   * 1. User-provided examples from @Tool decorator metadata (up to 5)
   * 2. Smart intent-based generation to fill remaining slots
   * 3. Returns at least 1 example
   */
  private generateExamples(
    tool: ToolEntry<any, any>,
    inputSchema?: JsonSchema,
  ): Array<{ description: string; code: string }> {
    const result: Array<{ description: string; code: string }> = [];

    // Priority 1: Use user-provided examples from metadata (up to 5)
    const examples = tool.metadata?.examples;
    if (examples && Array.isArray(examples)) {
      for (const ex of examples.slice(0, 5)) {
        result.push({
          description: ex.description || 'Example usage',
          code: `const result = await callTool('${tool.name}', ${JSON.stringify(ex.input, null, 2)});
return result;`,
        });
      }
    }

    // Priority 2: If fewer than 5 user examples, add smart-generated example
    if (result.length < 5) {
      result.push(generateSmartExample(tool.name, inputSchema, tool.metadata?.description));
    }

    return result.slice(0, 5);
  }
}
