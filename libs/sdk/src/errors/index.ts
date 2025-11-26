// Export all error classes
export {
  McpError,
  PublicMcpError,
  InternalMcpError,
  ToolNotFoundError,
  ResourceNotFoundError,
  ResourceReadError,
  InvalidResourceUriError,
  InvalidInputError,
  InvalidOutputError,
  InvalidMethodError,
  ToolExecutionError,
  RateLimitError,
  QuotaExceededError,
  UnauthorizedError,
  GenericServerError,
  DependencyNotFoundError,
  InvalidHookFlowError,
  PromptNotFoundError,
  PromptExecutionError,
  isPublicError,
  toMcpError,
  formatMcpErrorResponse,
} from './mcp.error';

// Export authorization required error for progressive auth
export {
  // Schemas
  authorizationRequiredDataSchema,
  authorizationRequiredParamsSchema,
  authorizationRequiredMetaSchema,
  // Types (inferred from schemas)
  AuthorizationRequiredData,
  AuthorizationRequiredParams,
  AuthorizationRequiredMeta,
  // Error class
  AuthorizationRequiredError,
} from './authorization-required.error';

// Export error handler utilities
export { ErrorHandler, ErrorHandlerOptions, createErrorHandler, shouldStopExecution } from './error-handler';
