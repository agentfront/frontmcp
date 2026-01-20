/**
 * Elicitation Module
 *
 * MCP elicitation support for requesting interactive user input
 * from clients during tool or agent execution.
 *
 * Uses @frontmcp/utils storage for unified backend support:
 * - Memory: For development and single-node deployments
 * - Redis: For distributed/multi-node production deployments
 * - Upstash: For edge deployments with pub/sub support
 *
 * Note: Vercel KV is NOT supported (no pub/sub capability).
 */

// Types
export * from './elicitation.types';

// Schemas
export { ELICITATION_FALLBACK_JSON_SCHEMA, type ElicitationFallbackResponse } from './elicitation-fallback.schema';

// Store module (unified storage-based implementation)
export * from './store';

// Helpers (for use by context classes)
export * from './helpers';

// Note: Flows and hooks are NOT exported from this barrel to avoid circular dependencies.
// Flows depend on FlowBase from common, but common depends on tool.interface which imports from elicitation.
// Import flows directly from 'elicitation/flows' where needed:
//   import { ElicitationRequestFlow, ElicitationResultFlow } from '../elicitation/flows';
// Import hooks directly from 'elicitation/hooks' where needed:
//   import { ElicitationRequestHook, ElicitationResultHook } from '../elicitation/hooks';

// Note: SendElicitationResultTool is also NOT exported here to avoid circular dependencies.
// It's imported directly where needed (e.g., tools-list.flow.ts).
