import { InternalMcpError } from './mcp.error';

/**
 * Thrown when a registry definition is not found by token.
 */
export class RegistryDefinitionNotFoundError extends InternalMcpError {
  constructor(registryName: string, tokenName: string) {
    super(`[${registryName}] Definition not found for token "${tokenName}"`, 'REGISTRY_DEFINITION_NOT_FOUND');
  }
}

/**
 * Thrown when a registry graph entry is not found by token.
 */
export class RegistryGraphEntryNotFoundError extends InternalMcpError {
  constructor(registryName: string, tokenName: string) {
    super(`[${registryName}] Graph entry not found for token "${tokenName}"`, 'REGISTRY_GRAPH_ENTRY_NOT_FOUND');
  }
}

/**
 * Thrown when a dependency referenced in a registry is not registered.
 */
export class RegistryDependencyNotRegisteredError extends InternalMcpError {
  constructor(entityType: string, tokenName: string, depName: string) {
    super(
      `${entityType} "${tokenName}" depends on "${depName}", which is not registered`,
      'REGISTRY_DEPENDENCY_NOT_REGISTERED',
    );
  }
}

/**
 * Thrown when a registry entry has an invalid or unsupported kind.
 */
export class InvalidRegistryKindError extends InternalMcpError {
  constructor(entityType: string, kind?: string) {
    super(kind ? `Invalid ${entityType} kind: "${kind}"` : `Invalid ${entityType} kind`, 'INVALID_REGISTRY_KIND');
  }
}

/**
 * Thrown when name disambiguation exceeds max attempts.
 */
export class NameDisambiguationError extends InternalMcpError {
  constructor(candidate: string, maxAttempts: number) {
    super(`Failed to disambiguate name "${candidate}" after ${maxAttempts} attempts`, 'NAME_DISAMBIGUATION_FAILED');
  }
}

/**
 * Thrown when a registry entry fails validation (missing required property).
 */
export class EntryValidationError extends InternalMcpError {
  constructor(entryType: string, details: string) {
    super(`${entryType} entry validation failed: ${details}`, 'ENTRY_VALIDATION_FAILED');
  }
}

/**
 * Thrown when a flow is not registered in the flow registry.
 */
export class FlowNotRegisteredError extends InternalMcpError {
  constructor(flowName: string) {
    super(`Flow "${flowName}" is not registered`, 'FLOW_NOT_REGISTERED');
  }
}

/**
 * Thrown when a hook has an unsupported owner kind.
 */
export class UnsupportedHookOwnerKindError extends InternalMcpError {
  constructor(kind: string) {
    super(`Unsupported hook owner kind: "${kind}"`, 'UNSUPPORTED_HOOK_OWNER_KIND');
  }
}
