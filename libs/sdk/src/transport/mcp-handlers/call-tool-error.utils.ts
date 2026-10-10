/** What a `tools/call` answers when its flow throws, shared by the inline handler and the task runner. */

import { CallToolResultSchema, type CallToolResult } from '@frontmcp/protocol';

import { FlowControl, type FrontMcpLogger } from '../../common';
import {
  formatMcpErrorResponse,
  InputRequiredSignal,
  InternalMcpError,
  MissingClientCapabilityError,
  TaskAugmentationNotSupportedError,
  TaskAugmentationRequiredError,
  ToolCredentialsRequiredError,
  type ErrorHandler,
} from '../../errors';
import { toSdkMcpError } from './mcp-error.utils';

export interface ToolCallErrorOptions {
  errorHandler: ErrorHandler;
  toolName: string;
  logger?: FrontMcpLogger;
}

/** The `CallToolResult` for a flow error; protocol-level outcomes are rethrown for the transport to answer as JSON-RPC. */
export function toolCallErrorResult(error: unknown, options: ToolCallErrorOptions): CallToolResult {
  const { errorHandler, toolName, logger } = options;

  if (error instanceof FlowControl) {
    if (error.type === 'respond') {
      const parsed = CallToolResultSchema.safeParse(error.output);
      if (parsed.success) return parsed.data;
      logger?.error('FlowControl.respond has invalid output', {
        tool: toolName,
        validationErrors: parsed.error.issues,
      });
      return formatMcpErrorResponse(new InternalMcpError('FlowControl output is not a valid CallToolResult'));
    }
    // #369 — `this.fail(error)` answers with the error passed to it, not the "Flow ended with: fail" sentinel.
    const original = (error as { originalError?: unknown }).originalError;
    if (error.type === 'fail' && original !== undefined) {
      return errorHandler.handle(original, { toolName });
    }
    logger?.warn(`FlowControl ended with type: ${error.type}`, {
      tool: toolName,
      type: error.type,
      output: error.output,
    });
    return formatMcpErrorResponse(new InternalMcpError(`Flow ended with: ${error.type}`));
  }

  // The tool asking the client for input, or naming a capability it must declare (protocol 2026-07-28).
  if (error instanceof InputRequiredSignal || error instanceof MissingClientCapabilityError) {
    throw error;
  }

  // MCP spec §Tool-Level Negotiation, and the credential gate's -32001 with { tool, providers, authUrl }.
  if (
    error instanceof TaskAugmentationNotSupportedError ||
    error instanceof TaskAugmentationRequiredError ||
    error instanceof ToolCredentialsRequiredError
  ) {
    throw toSdkMcpError(error);
  }

  return errorHandler.handle(error, { toolName });
}
