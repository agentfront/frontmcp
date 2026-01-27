/**
 * Connect Utilities
 *
 * Factory functions for creating DirectClient connections to FrontMCP servers.
 * These utilities are separate from the decorator to keep @FrontMcp lean.
 */

import type { FrontMcpConfigInput } from '../common';
import type { DirectClient, ConnectOptions, LLMConnectOptions } from './client.types';
import { PLATFORM_CLIENT_INFO } from './llm-platform';
import type { Scope } from '../scope/scope.instance';

// Cache for initialized scopes (singleton per parsed config)
// Using let to allow reassignment in clearScopeCache()
let scopeCache = new WeakMap<object, Promise<Scope>>();

/**
 * Get or create a scope for the given config.
 * Uses WeakMap caching to ensure singleton behavior per config object.
 *
 * @internal
 */
async function getScope(config: FrontMcpConfigInput): Promise<Scope> {
  // Create a unique cache key based on config
  // Since config is passed by reference, same config object = same scope
  const cacheKey = config as object;

  let scopePromise = scopeCache.get(cacheKey);
  if (!scopePromise) {
    scopePromise = (async () => {
      try {
        const { FrontMcpInstance } = await import('../front-mcp/front-mcp.js');
        const { PublicMcpError } = await import('../errors/index.js');

        // Create instance without starting HTTP server
        const instance = await FrontMcpInstance.createForGraph(config);
        const scopes = instance.getScopes();

        if (scopes.length === 0) {
          throw new PublicMcpError('No scopes initialized. Ensure at least one app is configured.', 'NO_SCOPES', 500);
        }

        return scopes[0] as Scope;
      } catch (error) {
        // Remove from cache on failure to allow retry
        scopeCache.delete(cacheKey);
        throw error;
      }
    })();
    scopeCache.set(cacheKey, scopePromise);
  }

  return scopePromise;
}

/**
 * Connect to a FrontMCP server with full options.
 *
 * Creates a DirectClient that connects via in-memory transport.
 * The client provides MCP operations with LLM-aware response formatting.
 *
 * @param config - FrontMCP configuration (same as @FrontMcp decorator)
 * @param options - Connection options including clientInfo, session, and authToken
 * @returns Connected DirectClient instance
 *
 * @example Basic connection
 * ```typescript
 * import { connect } from '@frontmcp/sdk';
 *
 * const client = await connect(MyServerConfig);
 * const tools = await client.listTools();  // Raw MCP format
 * await client.close();
 * ```
 *
 * @example With auth token
 * ```typescript
 * const client = await connect(MyServerConfig, {
 *   clientInfo: { name: 'my-agent', version: '1.0.0' },
 *   session: { id: 'session-123', user: { sub: 'user-1' } },
 *   authToken: 'jwt-token',
 * });
 * ```
 *
 * @example With custom client info (for platform detection)
 * ```typescript
 * const client = await connect(MyServerConfig, {
 *   clientInfo: { name: 'openai-agent', version: '1.0.0' },
 * });
 * // Tools will be formatted for OpenAI
 * const tools = await client.listTools();
 * ```
 */
export async function connect(config: FrontMcpConfigInput, options?: ConnectOptions): Promise<DirectClient> {
  const { DirectClientImpl } = await import('./direct-client.js');
  const scope = await getScope(config);
  return DirectClientImpl.create(scope, options);
}

/**
 * Connect to a FrontMCP server as an OpenAI client.
 *
 * Tools are automatically formatted for OpenAI function calling:
 * ```json
 * [{
 *   "type": "function",
 *   "function": {
 *     "name": "tool_name",
 *     "description": "Tool description",
 *     "parameters": { ... },
 *     "strict": true
 *   }
 * }]
 * ```
 *
 * @param config - FrontMCP configuration
 * @param options - Connection options (session, authToken)
 * @returns Connected DirectClient with OpenAI formatting
 *
 * @example
 * ```typescript
 * import { connectOpenAI } from '@frontmcp/sdk';
 * import OpenAI from 'openai';
 *
 * const client = await connectOpenAI(MyServerConfig, {
 *   authToken: 'user-jwt-token',
 *   session: { id: 'user-123' },
 * });
 *
 * const openai = new OpenAI();
 * const tools = await client.listTools();  // Already OpenAI format!
 *
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4-turbo',
 *   tools,
 *   messages: [{ role: 'user', content: 'What is the weather?' }],
 * });
 *
 * await client.close();
 * ```
 */
export async function connectOpenAI(config: FrontMcpConfigInput, options?: LLMConnectOptions): Promise<DirectClient> {
  return connect(config, {
    clientInfo: PLATFORM_CLIENT_INFO.openai,
    ...options,
  });
}

/**
 * Connect to a FrontMCP server as a Claude client.
 *
 * Tools are automatically formatted for Anthropic Claude:
 * ```json
 * [{
 *   "name": "tool_name",
 *   "description": "Tool description",
 *   "input_schema": { ... }
 * }]
 * ```
 *
 * @param config - FrontMCP configuration
 * @param options - Connection options (session, authToken)
 * @returns Connected DirectClient with Claude formatting
 *
 * @example
 * ```typescript
 * import { connectClaude } from '@frontmcp/sdk';
 * import Anthropic from '@anthropic-ai/sdk';
 *
 * const client = await connectClaude(MyServerConfig, { authToken: 'token' });
 * const tools = await client.listTools();  // Claude format
 *
 * const anthropic = new Anthropic();
 * const response = await anthropic.messages.create({
 *   model: 'claude-3-opus-20240229',
 *   tools,
 *   messages: [{ role: 'user', content: 'What is the weather?' }],
 * });
 *
 * await client.close();
 * ```
 */
export async function connectClaude(config: FrontMcpConfigInput, options?: LLMConnectOptions): Promise<DirectClient> {
  return connect(config, {
    clientInfo: PLATFORM_CLIENT_INFO.claude,
    ...options,
  });
}

/**
 * Connect to a FrontMCP server as a LangChain client.
 *
 * Tools are automatically formatted for LangChain:
 * ```json
 * [{
 *   "name": "tool_name",
 *   "description": "Tool description",
 *   "schema": { ... }
 * }]
 * ```
 *
 * @param config - FrontMCP configuration
 * @param options - Connection options (session, authToken)
 * @returns Connected DirectClient with LangChain formatting
 *
 * @example
 * ```typescript
 * import { connectLangChain } from '@frontmcp/sdk';
 *
 * const client = await connectLangChain(MyServerConfig);
 * const tools = await client.listTools();  // LangChain format
 *
 * // Use with LangChain agent
 * await client.close();
 * ```
 */
export async function connectLangChain(
  config: FrontMcpConfigInput,
  options?: LLMConnectOptions,
): Promise<DirectClient> {
  return connect(config, {
    clientInfo: PLATFORM_CLIENT_INFO.langchain,
    ...options,
  });
}

/**
 * Connect to a FrontMCP server as a Vercel AI SDK client.
 *
 * Tools are automatically formatted for Vercel AI SDK:
 * ```json
 * {
 *   "tool_name": {
 *     "description": "Tool description",
 *     "parameters": { ... }
 *   }
 * }
 * ```
 *
 * @param config - FrontMCP configuration
 * @param options - Connection options (session, authToken)
 * @returns Connected DirectClient with Vercel AI SDK formatting
 *
 * @example
 * ```typescript
 * import { connectVercelAI } from '@frontmcp/sdk';
 * import { generateText } from 'ai';
 *
 * const client = await connectVercelAI(MyServerConfig);
 * const tools = await client.listTools();  // Vercel AI SDK format
 *
 * const { text } = await generateText({
 *   model: openai('gpt-4-turbo'),
 *   tools,
 *   prompt: 'What is the weather?',
 * });
 *
 * await client.close();
 * ```
 */
export async function connectVercelAI(config: FrontMcpConfigInput, options?: LLMConnectOptions): Promise<DirectClient> {
  return connect(config, {
    clientInfo: PLATFORM_CLIENT_INFO['vercel-ai'],
    ...options,
  });
}

/**
 * Clear the scope cache (for testing).
 * Creates a new WeakMap instance to clear all cached entries.
 * @internal
 */
export function clearScopeCache(): void {
  scopeCache = new WeakMap<object, Promise<Scope>>();
}
