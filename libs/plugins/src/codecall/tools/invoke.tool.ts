// file: libs/plugins/src/codecall/tools/invoke.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import {
  InvokeToolInput,
  invokeToolInputSchema,
  InvokeToolOutput,
  invokeToolOutputSchema,
  invokeToolDescription,
} from './invoke.schema';

@Tool({
  name: 'codecall:invoke',
  cache: {
    ttl: 0, // No caching - each invocation is unique
    slideWindow: false,
  },
  description: invokeToolDescription,
  inputSchema: invokeToolInputSchema,
  outputSchema: invokeToolOutputSchema,
})
export default class InvokeTool extends ToolContext {
  async execute(input: InvokeToolInput): Promise<InvokeToolOutput> {
    const { tool, input: toolInput } = input;

    // TODO: Implement actual tool invocation
    // This should:
    // 1. Check if tool exists in the CodeCall index
    // 2. Check if tool is allowed for direct invocation (directCalls.allowedTools config)
    // 3. Validate toolInput against the tool's input schema
    // 4. Call the tool through the normal FrontMCP pipeline
    // 5. Return the result or error

    try {
      // TODO: Validate tool exists
      const toolExists = false; // Placeholder
      if (!toolExists) {
        return {
          status: 'error',
          error: {
            type: 'tool_not_found',
            message: `Tool "${tool}" not found. Check the tool name for typos or use codecall:search to discover available tools.`,
          },
        };
      }

      // TODO: Validate tool is allowed for direct calls
      const toolAllowed = false; // Placeholder
      if (!toolAllowed) {
        return {
          status: 'error',
          error: {
            type: 'permission_denied',
            message: `Tool "${tool}" is not enabled for direct invocation. Use codecall:execute to call it via JavaScript.`,
          },
        };
      }

      // TODO: Validate input against tool schema
      // const validationResult = validateToolInput(tool, toolInput);
      // if (!validationResult.valid) { return validation_error; }

      // TODO: Call the tool through the FrontMCP pipeline
      // const result = await this.callTool(tool, toolInput);

      return {
        status: 'success',
        result: {}, // TODO: Return actual tool result
      };
    } catch (error: any) {
      return {
        status: 'error',
        error: {
          type: 'execution_error',
          message: error.message || 'An error occurred while executing the tool',
          details: error,
        },
      };
    }
  }
}
