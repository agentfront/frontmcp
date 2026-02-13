import { InternalMcpError } from './mcp.error';

/**
 * Thrown when a provider token is not registered.
 */
export class ProviderNotRegisteredError extends InternalMcpError {
  constructor(tokenName: string, context?: string) {
    super(
      context ? `Provider "${tokenName}" is not registered (${context})` : `Provider "${tokenName}" is not registered`,
      'PROVIDER_NOT_REGISTERED',
    );
  }
}

/**
 * Thrown when a provider's scope doesn't match the expected scope.
 */
export class ProviderScopeMismatchError extends InternalMcpError {
  constructor(tokenName: string, scopeName: string, registryName: string) {
    super(
      `Provider "${tokenName}" has scope "${scopeName}" but was resolved in registry "${registryName}"`,
      'PROVIDER_SCOPE_MISMATCH',
    );
  }
}

/**
 * Thrown when a provider is expected to be instantiated but isn't.
 */
export class ProviderNotInstantiatedError extends InternalMcpError {
  constructor(tokenName: string, scope?: string, context?: string) {
    const parts = [`Provider "${tokenName}" is not instantiated`];
    if (scope) parts.push(`in scope "${scope}"`);
    if (context) parts.push(`(${context})`);
    super(parts.join(' '), 'PROVIDER_NOT_INSTANTIATED');
  }
}

/**
 * Thrown when a circular dependency is detected.
 */
export class DependencyCycleError extends InternalMcpError {
  constructor(cycle: string) {
    super(`Circular dependency detected: ${cycle}`, 'DEPENDENCY_CYCLE');
  }
}

/**
 * Thrown when provider construction fails.
 */
export class ProviderConstructionError extends InternalMcpError {
  readonly originalError?: Error;

  constructor(tokenName: string, cause?: Error | string, qualifier?: string) {
    const causeMsg = cause instanceof Error ? cause.message : cause;
    const parts = [`Failed to construct provider "${tokenName}"`];
    if (qualifier) parts.push(`[${qualifier}]`);
    if (causeMsg) parts.push(`: ${causeMsg}`);
    super(parts.join(''), 'PROVIDER_CONSTRUCTION_FAILED');
    this.originalError = cause instanceof Error ? cause : undefined;
  }
}

/**
 * Thrown when a provider dependency cannot be resolved.
 */
export class ProviderDependencyError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'PROVIDER_DEPENDENCY_ERROR');
  }
}

/**
 * Thrown when a scoped provider is accessed from the wrong scope.
 */
export class ProviderScopedAccessError extends InternalMcpError {
  constructor(tokenName: string, scopeName: string) {
    super(`Cannot access scoped provider "${tokenName}" from scope "${scopeName}"`, 'PROVIDER_SCOPED_ACCESS');
  }
}

/**
 * Thrown when a provider is not available in the current context.
 */
export class ProviderNotAvailableError extends InternalMcpError {
  constructor(tokenName: string, context?: string) {
    super(
      context ? `Provider "${tokenName}" is not available: ${context}` : `Provider "${tokenName}" is not available`,
      'PROVIDER_NOT_AVAILABLE',
    );
  }
}

/**
 * Thrown when a plugin dependency cannot be resolved.
 */
export class PluginDependencyError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'PLUGIN_DEPENDENCY_ERROR');
  }
}

/**
 * Thrown when a dependency has an invalid scope configuration.
 */
export class InvalidDependencyScopeError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'INVALID_DEPENDENCY_SCOPE');
  }
}
