// file: libs/plugins/src/codecall/tools/describe.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import type { JSONSchema7 } from 'json-schema';
import {
  DescribeToolInput,
  describeToolInputSchema,
  DescribeToolOutput,
  describeToolOutputSchema,
  describeToolDescription,
} from './describe.schema';
import {
  generateBasicExample,
  hasPaginationParams,
  hasFilterParams,
  getFilterProperties,
  generatePaginationExample,
  generateFilterExample,
} from '../utils/describe.utils';
import { isBlockedSelfReference } from '../security/self-reference-guard';

@Tool({
  name: 'codecall:describe',
  cache: {
    ttl: 60, // 1 minute
    slideWindow: false,
  },
  description: describeToolDescription,
  inputSchema: describeToolInputSchema,
  outputSchema: describeToolOutputSchema,
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

      // Get schemas
      const inputSchema = tool.rawInputSchema as JSONSchema7 | undefined;
      const outputSchema = tool.outputSchema as JSONSchema7 | undefined;

      // Generate usage example based on schema patterns
      const usageExample = this.generateExample(tool.name, inputSchema);

      tools.push({
        name: tool.name,
        appId,
        description: tool.metadata?.description || `Tool: ${tool.name}`,
        inputSchema: inputSchema || {},
        outputSchema: outputSchema || null,
        annotations: tool.metadata?.annotations,
        usageExample,
      });
    }

    return {
      tools,
      notFound: notFound.length > 0 ? notFound : undefined,
    };
  }

  /**
   * Extract app ID from tool metadata or owner.
   */
  private extractAppId(tool: {
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
    const nameParts = (tool as { name?: string }).name?.split(':');
    if (nameParts && nameParts.length > 1) {
      return nameParts[0];
    }

    return 'unknown';
  }

  /**
   * Generate an appropriate usage example based on schema patterns.
   */
  private generateExample(toolName: string, inputSchema?: JSONSchema7): { description: string; code: string } {
    // Check for pagination pattern
    if (hasPaginationParams(inputSchema)) {
      return generatePaginationExample(toolName);
    }

    // Check for filter pattern
    if (hasFilterParams(inputSchema)) {
      const filterProps = getFilterProperties(inputSchema);
      if (filterProps.length > 0) {
        return generateFilterExample(toolName, filterProps[0]);
      }
    }

    // Default to basic example
    return generateBasicExample(toolName, inputSchema);
  }
}
