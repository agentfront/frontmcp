// Export all error classes
export {
  // Base classes
  McpError,
  PublicMcpError,
  InternalMcpError,
  // Tool errors
  ToolNotFoundError,
  ToolExecutionError,
  // Resource errors
  ResourceNotFoundError,
  ResourceReadError,
  InvalidResourceUriError,
  // Validation errors
  InvalidInputError,
  InvalidOutputError,
  InvalidMethodError,
  // Rate limiting errors
  RateLimitError,
  QuotaExceededError,
  // Auth errors
  UnauthorizedError,
  // Session & client errors
  SessionMissingError,
  UnsupportedClientVersionError,
  // Internal errors
  GenericServerError,
  DependencyNotFoundError,
  InvalidHookFlowError,
  InvalidPluginScopeError,
  RequestContextNotAvailableError,
  // Configuration errors
  AuthConfigurationError,
  GlobalConfigNotFoundError,
  // Prompt errors
  PromptNotFoundError,
  PromptExecutionError,
  // Utilities
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

// Export elicitation errors
export {
  ElicitationNotSupportedError,
  ElicitationTimeoutError,
  ElicitationFallbackRequired,
} from './elicitation.error';

// Export remote MCP errors
export {
  // Connection errors
  RemoteConnectionError,
  RemoteDisconnectError,
  // Timeout errors
  RemoteTimeoutError,
  // Not found errors
  RemoteToolNotFoundError,
  RemoteResourceNotFoundError,
  RemotePromptNotFoundError,
  // Auth errors
  RemoteAuthError,
  RemoteAuthorizationError,
  // Execution errors
  RemoteToolExecutionError,
  RemoteResourceReadError,
  RemotePromptGetError,
  // Transport errors
  RemoteTransportError,
  RemoteUnsupportedTransportError,
  // Capability errors
  RemoteCapabilityDiscoveryError,
  RemoteCapabilityNotSupportedError,
  // Configuration errors
  RemoteConfigurationError,
  RemoteNotConnectedError,
} from './remote.errors';
