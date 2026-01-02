import 'reflect-metadata';
import {
  AgentMetadata,
  AgentType,
  FrontMcpAgentTokens,
  extendedAgentMetadata,
  AgentRecord,
  AgentKind,
  Token,
  Type,
} from '../common';
import { AgentConfigurationError } from '../errors/agent.errors';

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Check if a value is a class decorated with @Agent.
 */
export function isAgentClass(value: unknown): value is new (...args: unknown[]) => unknown {
  if (typeof value !== 'function') return false;
  return Reflect.getMetadata(FrontMcpAgentTokens.type, value) === true;
}

/**
 * Check if a value is a function-based agent created with agent().
 */
export function isAgentFunction(value: unknown): value is (() => void) & { [key: symbol]: unknown } {
  if (typeof value !== 'function') return false;
  const fn = value as unknown as Record<symbol, unknown>;
  return fn[FrontMcpAgentTokens.type] === 'function-agent';
}

/**
 * Extract metadata from a class decorated with @Agent.
 */
export function extractAgentClassMetadata(cls: Function): AgentMetadata {
  const metadata: AgentMetadata = {
    id: Reflect.getMetadata(FrontMcpAgentTokens.id, cls),
    name: Reflect.getMetadata(FrontMcpAgentTokens.name, cls),
    description: Reflect.getMetadata(FrontMcpAgentTokens.description, cls),
    systemInstructions: Reflect.getMetadata(FrontMcpAgentTokens.systemInstructions, cls),
    inputSchema: Reflect.getMetadata(FrontMcpAgentTokens.inputSchema, cls),
    outputSchema: Reflect.getMetadata(FrontMcpAgentTokens.outputSchema, cls),
    llm: Reflect.getMetadata(FrontMcpAgentTokens.llm, cls),
    providers: Reflect.getMetadata(FrontMcpAgentTokens.providers, cls),
    plugins: Reflect.getMetadata(FrontMcpAgentTokens.plugins, cls),
    adapters: Reflect.getMetadata(FrontMcpAgentTokens.adapters, cls),
    agents: Reflect.getMetadata(FrontMcpAgentTokens.agents, cls),
    tools: Reflect.getMetadata(FrontMcpAgentTokens.tools, cls),
    resources: Reflect.getMetadata(FrontMcpAgentTokens.resources, cls),
    prompts: Reflect.getMetadata(FrontMcpAgentTokens.prompts, cls),
    exports: Reflect.getMetadata(FrontMcpAgentTokens.exports, cls),
    swarm: Reflect.getMetadata(FrontMcpAgentTokens.swarm, cls),
    execution: Reflect.getMetadata(FrontMcpAgentTokens.execution, cls),
    tags: Reflect.getMetadata(FrontMcpAgentTokens.tags, cls),
    hideFromDiscovery: Reflect.getMetadata(FrontMcpAgentTokens.hideFromDiscovery, cls),
  };

  // Merge extended metadata
  const extended = Reflect.getMetadata(extendedAgentMetadata, cls);
  if (extended) {
    Object.assign(metadata, extended);
  }

  return metadata;
}

/**
 * Extract metadata from a function-based agent.
 */
export function extractAgentFunctionMetadata(fn: (() => void) & { [key: symbol]: unknown }): AgentMetadata {
  const record = fn as unknown as Record<symbol, unknown>;
  return record[FrontMcpAgentTokens.metadata] as AgentMetadata;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize an agent type into an AgentRecord.
 *
 * Handles:
 * - Class decorated with @Agent
 * - Function created with agent()
 * - Value/Factory objects
 */
export function normalizeAgent(agent: AgentType): AgentRecord {
  // Class decorated with @Agent
  if (isAgentClass(agent)) {
    const metadata = extractAgentClassMetadata(agent as Function);
    return {
      kind: AgentKind.CLASS_TOKEN,
      provide: agent as Type,
      metadata,
      providers: metadata.providers,
    };
  }

  // Function created with agent()
  if (isAgentFunction(agent)) {
    const metadata = extractAgentFunctionMetadata(agent);
    return {
      kind: AgentKind.FUNCTION,
      provide: agent,
      metadata,
      providers: metadata.providers,
    };
  }

  // Value or Factory object
  if (typeof agent === 'object' && agent !== null) {
    const obj = agent as Record<string, unknown>;

    // useValue pattern
    if ('useValue' in obj && 'metadata' in obj) {
      const metadata = obj['metadata'] as AgentMetadata;
      const provide = (obj['provide'] as Token) ?? Symbol(`Agent:${metadata.name}`);
      return {
        kind: AgentKind.VALUE,
        provide,
        useValue: obj['useValue'],
        metadata,
        providers: metadata.providers,
      };
    }

    // useFactory pattern
    if ('useFactory' in obj && 'metadata' in obj) {
      const metadata = obj['metadata'] as AgentMetadata;
      const provide = (obj['provide'] as Token) ?? Symbol(`Agent:${metadata.name}`);
      return {
        kind: AgentKind.FACTORY,
        provide,
        useFactory: obj['useFactory'] as (...args: unknown[]) => unknown,
        inject: obj['inject'] as Token[] | undefined,
        metadata,
        providers: metadata.providers,
      };
    }
  }

  throw new Error(
    'Invalid agent type. Expected class decorated with @Agent, ' +
      'function created with agent(), or { useValue/useFactory, metadata } object.',
  );
}

// ============================================================================
// Discovery Dependencies
// ============================================================================

/**
 * Get dependencies needed for agent discovery.
 *
 * Returns the tokens that should be resolved before the agent can be instantiated.
 */
export function agentDiscoveryDeps(record: AgentRecord): Token[] {
  const deps: Token[] = [];

  // Add providers that need resolution
  if (record.providers) {
    for (const provider of record.providers) {
      if (typeof provider === 'function') {
        deps.push(provider);
      } else if (typeof provider === 'object' && provider !== null && 'provide' in provider) {
        deps.push((provider as { provide: Token }).provide);
      }
    }
  }

  // Add factory inject dependencies
  if (record.kind === AgentKind.FACTORY && 'inject' in record && record.inject) {
    deps.push(...record.inject);
  }

  return deps;
}

// ============================================================================
// Name Utilities
// ============================================================================

/**
 * Reserved prefix for agent tool names.
 * Tools cannot use this prefix - it's reserved for agent invocations.
 */
export const AGENT_TOOL_PREFIX = 'use-agent:';

/**
 * Generate the tool name for an agent.
 *
 * @param agentId The agent's ID
 * @returns Tool name in format `use-agent:<agentId>`
 */
export function agentToolName(agentId: string): string {
  // Sanitize the agent ID for use in a tool name
  const sanitized = agentId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');

  // Warn about potential collisions when sanitization modifies the ID
  if (sanitized !== agentId) {
    console.warn(
      `Agent ID "${agentId}" was sanitized to "${sanitized}" for tool name. ` +
        `Different IDs may produce the same tool name - check for potential collisions.`,
    );
  }

  return `${AGENT_TOOL_PREFIX}${sanitized}`;
}

/**
 * Check if a tool name is an agent invocation.
 *
 * @param toolName Tool name to check
 * @returns True if the tool name starts with the agent prefix
 */
export function isAgentToolName(toolName: string): boolean {
  return toolName.startsWith(AGENT_TOOL_PREFIX);
}

/**
 * Extract agent ID from a tool name.
 *
 * @param toolName Tool name in format `use-agent:<agentId>`
 * @returns Agent ID or null if not an agent tool
 */
export function agentIdFromToolName(toolName: string): string | null {
  if (!isAgentToolName(toolName)) return null;
  return toolName.slice(AGENT_TOOL_PREFIX.length);
}

/**
 * Generate the full name for an agent including owner path.
 *
 * @param agentName The agent's name
 * @param ownerPath Array of owner names (e.g., ['app', 'plugin'])
 * @returns Full name like 'app.plugin.agent'
 */
export function agentFullName(agentName: string, ownerPath: string[]): string {
  return [...ownerPath, agentName].join('.');
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate agent metadata for required fields.
 */
export function validateAgentMetadata(metadata: AgentMetadata): void {
  if (!metadata.name || metadata.name.trim() === '') {
    throw new AgentConfigurationError('Agent metadata.name is required');
  }

  if (!metadata.llm) {
    throw new AgentConfigurationError('Agent metadata.llm is required', { agentId: metadata.name });
  }
}

/**
 * Check if an agent is visible to swarm.
 */
export function isAgentVisibleToSwarm(metadata: AgentMetadata): boolean {
  return metadata.swarm?.isVisible !== false;
}

/**
 * Check if an agent can see other agents in swarm.
 */
export function canAgentSeeSwarm(metadata: AgentMetadata): boolean {
  return metadata.swarm?.canSeeOtherAgents === true;
}

/**
 * Get the list of visible agent IDs for an agent.
 * Returns empty array if agent cannot see swarm or has no specific visibility list.
 */
export function getVisibleAgentIds(metadata: AgentMetadata): string[] {
  if (!canAgentSeeSwarm(metadata)) return [];
  return metadata.swarm?.visibleAgents ?? [];
}
