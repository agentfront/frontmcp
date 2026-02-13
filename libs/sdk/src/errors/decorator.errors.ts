import { InternalMcpError } from './mcp.error';

/**
 * Thrown when a decorator receives invalid metadata (e.g., @App, @Plugin, @FrontMcp).
 */
export class InvalidDecoratorMetadataError extends InternalMcpError {
  constructor(decoratorName: string, field: string, details: string) {
    super(`@${decoratorName} invalid metadata for "${field}": ${details}`, 'INVALID_DECORATOR_METADATA');
  }
}

/**
 * Thrown when a hook target method is not defined on the class.
 */
export class HookTargetNotDefinedError extends InternalMcpError {
  constructor(method: string) {
    super(`Hook target method "${method}" is not defined`, 'HOOK_TARGET_NOT_DEFINED');
  }
}
