/**
 * Agent system for FrontMCP SDK.
 *
 * This module provides the infrastructure for creating autonomous AI agents
 * that can have their own LLM providers, isolated scopes, and be invoked as tools.
 *
 * @example Creating an agent
 * ```typescript
 * import { Agent, AgentContext } from '@frontmcp/sdk';
 * import { z } from '@frontmcp/lazy-zod';
 *
 * @Agent({
 *   name: 'research-agent',
 *   description: 'Researches topics and compiles reports',
 *   systemInstructions: 'You are a research assistant...',
 *   inputSchema: {
 *     topic: z.string().describe('Topic to research'),
 *   },
 *   llm: {
 *     adapter: 'openai',
 *     model: 'gpt-4-turbo',
 *     apiKey: { env: 'OPENAI_API_KEY' },
 *   },
 *   tools: [WebSearchTool, SummarizeTool],
 * })
 * export default class ResearchAgent extends AgentContext {
 *   async execute(input: { topic: string }) {
 *     // Agent implementation
 *     return { summary: 'Research results...' };
 *   }
 * }
 * ```
 *
 * @module agent
 */

// Core exports
export * from './agent.events';
export * from './agent.utils';
export { AgentInstance } from './agent.instance';
export { default as AgentRegistry } from './agent.registry';
export type { IndexedAgent } from './agent.registry';
export * from './agent-execution-loop';

// Flow exports
export * from './flows';

// Hook exports
export * from './hooks';

// Adapter exports
export * from './adapters';

// Re-export common types for convenience
export { AgentContext } from '../common/interfaces/agent.interface';
export type { AgentCtorArgs } from '../common/interfaces/agent.interface';

export { AgentEntry } from '../common/entries/agent.entry';
export type { AgentCallArgs, AgentCallExtra, ParsedAgentResult } from '../common/entries/agent.entry';

export { withConfig, frontMcpAgentMetadataSchema } from '../common/metadata/agent.metadata';
export type {
  AgentMetadata,
  AgentLlmConfig,
  AgentLlmBuiltinConfig,
  AgentLlmAdapterConfig,
  AgentSwarmConfig,
  AgentExecutionConfig,
  AgentExportsConfig,
  AgentApiKeyConfig,
  AgentLlmProviderType,
  WithConfig,
  AgentType,
} from '../common/metadata/agent.metadata';

export { annotatedFrontMcpAgentsSchema } from '../common/schemas';

export { AgentKind } from '../common/records/agent.record';
export type {
  AgentRecord,
  AgentClassTokenRecord,
  AgentFunctionTokenRecord,
  AgentValueRecord,
  AgentFactoryRecord,
} from '../common/records/agent.record';

export { FrontMcpAgentTokens, extendedAgentMetadata } from '../common/tokens/agent.tokens';

export { Agent, FrontMcpAgent, agent, frontMcpAgent } from '../common/decorators/agent.decorator';
export type { AgentInputOf, AgentOutputOf, FrontMcpAgentExecuteHandler } from '../common/decorators/agent.decorator';
