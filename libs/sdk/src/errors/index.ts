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
  ElicitationStoreNotInitializedError,
  ElicitationDisabledError,
  ElicitationEncryptionError,
  ElicitationSubscriptionError,
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
  // Retry errors
  InvalidRetryOptionsError,
} from './remote.errors';

// Export normalization errors
export {
  MissingProvideError,
  InvalidUseClassError,
  InvalidUseFactoryError,
  InvalidUseValueError,
  InvalidEntityError,
} from './normalization.errors';

// Export registry errors
export {
  RegistryDefinitionNotFoundError,
  RegistryGraphEntryNotFoundError,
  RegistryDependencyNotRegisteredError,
  InvalidRegistryKindError,
  NameDisambiguationError,
  EntryValidationError,
  FlowNotRegisteredError,
  UnsupportedHookOwnerKindError,
} from './registry.errors';

// Export provider errors
export {
  ProviderNotRegisteredError,
  ProviderScopeMismatchError,
  ProviderNotInstantiatedError,
  DependencyCycleError,
  ProviderConstructionError,
  ProviderDependencyError,
  ProviderScopedAccessError,
  ProviderNotAvailableError,
  PluginDependencyError,
  InvalidDependencyScopeError,
} from './provider.errors';

// Export decorator errors
export { InvalidDecoratorMetadataError, HookTargetNotDefinedError } from './decorator.errors';

// Export transport errors
export {
  MethodNotImplementedError,
  UnsupportedTransportTypeError,
  TransportBusRequiredError,
  InvalidTransportSessionError,
  TransportNotConnectedError,
  TransportAlreadyStartedError,
  UnsupportedContentTypeError,
} from './transport.errors';

// Export auth internal errors
export {
  EncryptionContextNotSetError,
  VaultLoadError,
  VaultNotFoundError,
  TokenNotAvailableError,
  TokenStoreRequiredError,
  NoProviderIdError,
  TokenLeakDetectedError,
  SessionSecretRequiredError,
  CredentialProviderAlreadyRegisteredError,
  AuthProvidersNotConfiguredError,
  OrchestratedAuthNotAvailableError,
  EncryptionKeyNotConfiguredError,
  SessionIdEmptyError,
  ElicitationSecretRequiredError,
  ScopeDeniedError,
  InMemoryStoreRequiredError,
  OrchestratorJwksNotAvailableError,
} from './auth-internal.errors';

// Export workflow errors
export {
  WorkflowStepNotFoundError,
  WorkflowTimeoutError,
  WorkflowDagValidationError,
  WorkflowJobTimeoutError,
} from './workflow.errors';

// Export SDK errors
export {
  FlowExitedWithoutOutputError,
  ServerNotFoundError,
  ConfigNotFoundError,
  SessionVerificationFailedError,
  ContextExtensionNotAvailableError,
  ScopeConfigurationError,
  InvokeStateMissingKeyError,
  SkillSessionError,
  InvalidSkillError,
  SkillInstructionFetchError,
  InvalidInstructionSourceError,
  ServerlessHandlerNotInitializedError,
  MissingPromptArgumentError,
  DynamicAdapterNameError,
  AgentConfigKeyNotFoundError,
  AgentToolExecutionError,
  AgentMethodNotAvailableError,
  VercelKvNotSupportedError,
  VercelKvAsyncInitRequiredError,
  RequiredConfigUndefinedError,
  RegistryNotInitializedError,
  EnclaveExecutionError,
  FlowInputMissingError,
  DynamicJobDirectExecutionError,
} from './sdk.errors';
