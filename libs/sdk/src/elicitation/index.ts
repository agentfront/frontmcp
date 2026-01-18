/**
 * Elicitation Module
 *
 * MCP elicitation support for requesting interactive user input
 * from clients during tool or agent execution.
 *
 * Supports both single-node (in-memory) and distributed (Redis) deployments:
 * - InMemoryElicitationStore: For development and single-node deployments
 * - RedisElicitationStore: For distributed/multi-node production deployments
 */

export * from './elicitation.types';
export * from './elicitation.store';
export { InMemoryElicitationStore } from './memory-elicitation.store';
export { RedisElicitationStore } from './redis-elicitation.store';
