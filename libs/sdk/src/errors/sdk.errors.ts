import { InternalMcpError, PublicMcpError } from './mcp.error';

/**
 * Thrown when a flow exits without producing output.
 */
export class FlowExitedWithoutOutputError extends InternalMcpError {
  constructor() {
    super('Flow exited without producing output', 'FLOW_EXITED_WITHOUT_OUTPUT');
  }
}

/**
 * Thrown when no MCP server is found.
 */
export class ServerNotFoundError extends InternalMcpError {
  constructor() {
    super('Server not found', 'SERVER_NOT_FOUND');
  }
}

/**
 * Thrown when a config file is not found.
 */
export class ConfigNotFoundError extends InternalMcpError {
  constructor(path: string, triedPaths?: string[]) {
    const msg = triedPaths?.length
      ? `Config not found at "${path}". Tried: ${triedPaths.join(', ')}`
      : `Config not found at "${path}"`;
    super(msg, 'CONFIG_NOT_FOUND');
  }
}

/**
 * Thrown when session verification fails.
 */
export class SessionVerificationFailedError extends InternalMcpError {
  constructor() {
    super('Session verification failed', 'SESSION_VERIFICATION_FAILED');
  }
}

/**
 * Thrown when a context extension is not available.
 */
export class ContextExtensionNotAvailableError extends InternalMcpError {
  readonly originalError?: Error;

  constructor(message: string, cause?: Error) {
    super(message, 'CONTEXT_EXTENSION_NOT_AVAILABLE');
    this.originalError = cause;
  }
}

/**
 * Thrown when scope configuration is invalid.
 */
export class ScopeConfigurationError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'SCOPE_CONFIGURATION_ERROR');
  }
}

/**
 * Thrown when an invoke state key is missing.
 */
export class InvokeStateMissingKeyError extends InternalMcpError {
  constructor(key: string) {
    super(`Invoke state missing key: "${key}"`, 'INVOKE_STATE_MISSING_KEY');
  }
}

/**
 * Thrown when a skill session operation fails.
 */
export class SkillSessionError extends InternalMcpError {
  constructor(operation: string, reason: string) {
    super(`Skill session ${operation} failed: ${reason}`, 'SKILL_SESSION_ERROR');
  }
}

/**
 * Thrown when a skill is invalid.
 */
export class InvalidSkillError extends InternalMcpError {
  constructor(name: string, details: string) {
    super(`Invalid skill "${name}": ${details}`, 'INVALID_SKILL');
  }
}

/**
 * Thrown when fetching skill instructions fails.
 */
export class SkillInstructionFetchError extends InternalMcpError {
  constructor(url: string, status: number, statusText: string) {
    super(
      `Failed to fetch skill instructions from "${url}": ${status} ${statusText}`,
      'SKILL_INSTRUCTION_FETCH_FAILED',
    );
  }
}

/**
 * Thrown when an instruction source is invalid.
 */
export class InvalidInstructionSourceError extends InternalMcpError {
  constructor() {
    super('Invalid instruction source', 'INVALID_INSTRUCTION_SOURCE');
  }
}

/**
 * Thrown when a serverless handler is not initialized.
 */
export class ServerlessHandlerNotInitializedError extends InternalMcpError {
  constructor() {
    super('Serverless handler is not initialized', 'SERVERLESS_HANDLER_NOT_INITIALIZED');
  }
}

/**
 * Thrown when a required prompt argument is missing.
 * This is a PUBLIC error (400) since it represents user-facing input validation.
 */
export class MissingPromptArgumentError extends PublicMcpError {
  constructor(argName: string) {
    super(`Missing required argument: ${argName}`, 'MISSING_PROMPT_ARGUMENT', 400);
  }
}

/**
 * Thrown when a dynamic adapter has a name conflict.
 */
export class DynamicAdapterNameError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'DYNAMIC_ADAPTER_NAME_ERROR');
  }
}

/**
 * Thrown when an agent config key is not found.
 */
export class AgentConfigKeyNotFoundError extends InternalMcpError {
  constructor(path: string) {
    super(`Agent config key not found: "${path}"`, 'AGENT_CONFIG_KEY_NOT_FOUND');
  }
}

/**
 * Thrown when an agent tool execution fails.
 */
export class AgentToolExecutionError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'AGENT_TOOL_EXECUTION_ERROR');
  }
}

/**
 * Thrown when an agent method is not available.
 */
export class AgentMethodNotAvailableError extends InternalMcpError {
  constructor(method: string, name: string) {
    super(`Agent method "${method}" is not available on "${name}"`, 'AGENT_METHOD_NOT_AVAILABLE');
  }
}

/**
 * Thrown when Vercel KV does not support a feature.
 */
export class VercelKvNotSupportedError extends InternalMcpError {
  constructor(feature: string) {
    super(`Vercel KV does not support: ${feature}`, 'VERCEL_KV_NOT_SUPPORTED');
  }
}

/**
 * Thrown when Vercel KV async initialization is required.
 */
export class VercelKvAsyncInitRequiredError extends InternalMcpError {
  constructor(message?: string) {
    super(
      message || 'Vercel KV requires async initialization. Call init() before use.',
      'VERCEL_KV_ASYNC_INIT_REQUIRED',
    );
  }
}

/**
 * Thrown when a required config value is undefined.
 */
export class RequiredConfigUndefinedError extends InternalMcpError {
  constructor(path: string) {
    super(`Required configuration path "${path}" is undefined`, 'REQUIRED_CONFIG_UNDEFINED');
  }
}

/**
 * Thrown when a flow stage receives missing or undefined input
 * (e.g., `request` is undefined in a well-known flow's parseInput stage).
 */
export class FlowInputMissingError extends InternalMcpError {
  readonly field: string;
  readonly flowName?: string;

  constructor(field: string, flowName?: string) {
    const msg = flowName
      ? `Flow "${flowName}" is missing required input: "${field}"`
      : `Flow input missing required field: "${field}"`;
    super(msg, 'FLOW_INPUT_MISSING');
    this.field = field;
    this.flowName = flowName;
  }
}
