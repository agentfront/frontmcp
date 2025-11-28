// file: libs/plugins/src/codecall/tools/invoke.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { JSONSchema7 } from 'json-schema';
import { ZodError } from 'zod';
import {
  InvokeToolInput,
  invokeToolInputSchema,
  InvokeToolOutput,
  invokeToolOutputSchema,
  invokeToolDescription,
} from './invoke.schema';
import { isBlockedSelfReference } from '../security';
import { createToolCallError, TOOL_CALL_ERROR_CODES } from '../errors';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

/**
 * Extract the actual result from a CallToolResult.
 * MCP returns results wrapped in content array format.
 */
function extractResultFromCallToolResult(mcpResult: CallToolResult): unknown {
  // MCP CallToolResult has { content: [...], isError?: boolean }
  if (mcpResult.isError) {
    // If it's an error, extract the error message from content
    const errorContent = mcpResult.content?.[0];
    if (errorContent && 'text' in errorContent) {
      throw new Error(errorContent.text);
    }
    throw new Error('Tool execution failed');
  }

  // For successful results, try to extract the actual data
  const content = mcpResult.content;
  if (!content || content.length === 0) {
    return undefined;
  }

  // If there's a single text content, try to parse as JSON
  if (content.length === 1 && content[0].type === 'text') {
    try {
      return JSON.parse(content[0].text);
    } catch {
      return content[0].text;
    }
  }

  // Return the raw content for complex results
  return content;
}

/**
 * InvokeTool allows direct tool invocation without running JavaScript code.
 *
 * Security Considerations:
 * - Self-reference blocking: Cannot invoke codecall:* tools
 * - Input validation: Validates against tool's input schema before execution
 * - All middleware (auth, PII, rate limiting) applies via normal tool execution
 * - Error messages are sanitized to prevent information leakage
 */
@Tool({
  name: 'codecall:invoke',
  cache: {
    ttl: 0, // No caching - each invocation is unique
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: invokeToolDescription,
  inputSchema: invokeToolInputSchema,
  outputSchema: invokeToolOutputSchema,
})
export default class InvokeTool extends ToolContext {
  async execute(input: InvokeToolInput): Promise<InvokeToolOutput> {
    const { tool: toolName, input: toolInput } = input;

    // ============================================================
    // SECURITY LAYER 1: Self-reference blocking (FIRST CHECK)
    // Cannot invoke codecall:* tools to prevent recursion attacks
    // ============================================================
    if (isBlockedSelfReference(toolName)) {
      return {
        status: 'error',
        error: {
          type: 'permission_denied',
          message: `Tool "${toolName}" cannot be invoked directly. CodeCall tools are internal and not accessible via codecall:invoke.`,
        },
      };
    }

    // ============================================================
    // SECURITY LAYER 2: Find the tool in registry
    // ============================================================
    const allTools = this.scope.tools.getTools(true);
    const tool = allTools.find((t) => t.name === toolName || t.fullName === toolName);

    if (!tool) {
      return {
        status: 'error',
        error: {
          type: 'tool_not_found',
          message: `Tool "${toolName}" not found. Check the tool name for typos or use codecall:search to discover available tools.`,
        },
      };
    }

    // ============================================================
    // SECURITY LAYER 3: Validate input against tool schema
    // This prevents malformed inputs from reaching the tool
    // ============================================================
    const validationResult = this.validateToolInput(tool.rawInputSchema as JSONSchema7, toolInput, toolName);
    if (!validationResult.valid) {
      return {
        status: 'error',
        error: {
          type: 'validation_error',
          message: validationResult.message,
          details: validationResult.details,
        },
      };
    }

    // ============================================================
    // Execute the tool through the proper flow system
    // This ensures hooks, validation, quota, and all middleware run
    // ============================================================
    try {
      // Build MCP-compatible CallToolRequest
      const request = {
        method: 'tools/call' as const,
        params: {
          name: toolName,
          arguments: toolInput,
        },
      };

      // Build context with auth info
      const ctx = {
        authInfo: this.authInfo,
      };

      // Execute through the flow system - this runs all stages:
      // PRE: parseInput → findTool → createToolCallContext → acquireQuota → acquireSemaphore
      // EXECUTE: validateInput → execute → validateOutput
      // FINALIZE: releaseSemaphore → releaseQuota → finalize
      const mcpResult = await this.scope.runFlow('tools:call-tool', { request, ctx });

      if (!mcpResult) {
        return {
          status: 'error',
          error: {
            type: 'execution_error',
            message: `Tool "${toolName}" execution failed: Flow returned no result`,
          },
        };
      }

      // Extract the actual result from MCP CallToolResult format
      const result = extractResultFromCallToolResult(mcpResult);

      return {
        status: 'success',
        result,
      };
    } catch (error: unknown) {
      // ============================================================
      // Error sanitization - NEVER expose internal details
      // ============================================================
      const sanitizedError = this.sanitizeError(error, toolName);

      return {
        status: 'error',
        error: {
          type: 'execution_error',
          message: sanitizedError.message,
          details: sanitizedError.details,
        },
      };
    }
  }

  /**
   * Validate tool input against its JSON schema.
   * Uses json-schema-to-zod for runtime validation.
   */
  private validateToolInput(
    schema: JSONSchema7 | undefined,
    input: Record<string, unknown>,
    toolName: string,
  ): { valid: true } | { valid: false; message: string; details?: unknown } {
    // If no schema, allow any input (tool may do its own validation)
    if (!schema) {
      return { valid: true };
    }

    try {
      // Convert JSON Schema to Zod for validation
      const zodSchema = convertJsonSchemaToZod(schema);
      zodSchema.parse(input);
      return { valid: true };
    } catch (error) {
      if (error instanceof ZodError) {
        // Format validation errors in a user-friendly way
        const issues = error.issues.map((issue) => {
          const path = issue.path.join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        });

        return {
          valid: false,
          message: `Input validation failed for tool "${toolName}": ${issues.join('; ')}`,
          details: {
            issues: error.issues.map((i) => ({
              path: i.path,
              message: i.message,
              expected: (i as any).expected,
              received: (i as any).received,
            })),
          },
        };
      }

      // Schema conversion error - provide generic message
      return {
        valid: false,
        message: `Unable to validate input for tool "${toolName}". Please check the input matches the expected schema.`,
      };
    }
  }

  /**
   * Sanitize error messages to prevent information leakage.
   * Never expose stack traces, file paths, or internal details.
   */
  private sanitizeError(error: unknown, toolName: string): { message: string; details?: Record<string, unknown> } {
    // Create a sanitized error using the shared utility
    const toolCallError = createToolCallError(
      TOOL_CALL_ERROR_CODES.EXECUTION,
      toolName,
      error instanceof Error ? error.message : undefined,
    );

    return {
      message: toolCallError.message,
      // Only include safe, non-sensitive details
      details: error instanceof Error && error.name ? { errorType: error.name } : undefined,
    };
  }
}
