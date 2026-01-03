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
  InvalidPluginScopeError,
  AuthConfigurationError,
  PromptNotFoundError,
  PromptExecutionError,
  GlobalConfigNotFoundError,
  isPublicError,
  toMcpError,
  formatMcpErrorResponse,
  // Error codes
  MCP_ERROR_CODES,
  type McpErrorCode,
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

// Export agent errors
export {
  AgentNotFoundError,
  AgentExecutionError,
  AgentLoopExceededError,
  AgentTimeoutError,
  AgentVisibilityError,
  AgentLlmError,
  AgentConfigurationError,
  AgentNotConfiguredError,
  AgentToolNotFoundError,
} from './agent.errors';
