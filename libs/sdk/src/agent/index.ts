/**
 * Agent system for FrontMCP SDK.
 *
 * This module provides the infrastructure for creating autonomous AI agents
 * that can have their own LLM providers, isolated scopes, and be invoked as tools.
 *
 * @example Creating an agent
 * ```typescript
 * import { Agent, AgentContext } from '@frontmcp/sdk';
 * import { z } from 'zod';
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
export { default as AgentRegistry, IndexedAgent } from './agent.registry';
export * from './agent-execution-loop';

// Flow exports
export * from './flows';

// Hook exports
export * from './hooks';

// Adapter exports
export * from './adapters';

// Re-export common types for convenience
export { AgentContext, AgentCtorArgs } from '../common/interfaces/agent.interface';

export { AgentEntry, AgentCallArgs, AgentCallExtra, ParsedAgentResult } from '../common/entries/agent.entry';

export {
  AgentMetadata,
  AgentLlmConfig,
  AgentLlmBuiltinConfig,
  AgentLlmAdapterConfig,
  AgentSwarmConfig,
  AgentExecutionConfig,
  AgentExportsConfig,
  AgentApiKeyConfig,
  AgentLlmAdapterType,
  WithConfig,
  withConfig,
  AgentType,
  frontMcpAgentMetadataSchema,
  annotatedFrontMcpAgentsSchema,
} from '../common/metadata/agent.metadata';

export {
  AgentRecord,
  AgentKind,
  AgentClassTokenRecord,
  AgentFunctionTokenRecord,
  AgentValueRecord,
  AgentFactoryRecord,
} from '../common/records/agent.record';

export { FrontMcpAgentTokens, extendedAgentMetadata } from '../common/tokens/agent.tokens';

export {
  Agent,
  FrontMcpAgent,
  agent,
  frontMcpAgent,
  AgentInputOf,
  AgentOutputOf,
  FrontMcpAgentExecuteHandler,
} from '../common/decorators/agent.decorator';
