/**
 * Connect Utilities
 *
 * Factory functions for creating DirectClient connections to FrontMCP servers.
 * These utilities are separate from the decorator to keep @FrontMcp lean.
 */

import 'reflect-metadata';

import { getDecoratorConfig, type FrontMcpConfigInput } from '../common';
import type { FrontMcpInstance } from '../front-mcp/front-mcp';
import type { Scope } from '../scope/scope.instance';
import type { ConnectOptions, DirectClient, LLMConnectOptions } from './client.types';
import { PLATFORM_CLIENT_INFO } from './llm-platform';

// Cache for initialized servers (singleton per parsed config)
// Using let to allow reassignment in clearScopeCache()
let instanceCache = new WeakMap<object, Promise<FrontMcpInstance>>();

/** How many connected clients share each cached server. */
const instanceClients = new WeakMap<Promise<FrontMcpInstance>, number>();

/**
 * Get or create the server for the given config.
 * Uses WeakMap caching to ensure singleton behavior per config object.
 * Synchronous up to the cache lookup, so a caller can count its client before anything else runs.
 *
 * @internal
 */
function getInstance(
  config: FrontMcpConfigInput,
  mode?: 'full' | 'cli',
): { cacheKey: object; instancePromise: Promise<FrontMcpInstance> } {
  // Handle @FrontMcp-decorated class (e.g., from schema-extractor loading a bundle).
  // `getDecoratorConfig` returns the parsed metadata via the SDK's stable accessor.
  let resolvedConfig = config;
  if (typeof config === 'function') {
    const stored = getDecoratorConfig(config);
    if (stored) {
      resolvedConfig = stored as FrontMcpConfigInput;
    }
  }
  // Create a unique cache key based on config
  // Since config is passed by reference, same config object = same server
  const cacheKey = resolvedConfig as object;

  let instancePromise = instanceCache.get(cacheKey);
  if (!instancePromise) {
    instancePromise = (async () => {
      try {
        const { FrontMcpInstance } = await import('../front-mcp/front-mcp.js');
        // Create instance without starting HTTP server
        // CLI mode skips non-essential registries for faster startup
        return mode === 'cli'
          ? await FrontMcpInstance.createForCli(resolvedConfig)
          : await FrontMcpInstance.createForGraph(resolvedConfig);
      } catch (error) {
        // Remove from cache on failure to allow retry
        instanceCache.delete(cacheKey);
        throw error;
      }
    })();
    instanceCache.set(cacheKey, instancePromise);
  }

  return { cacheKey, instancePromise };
}

/**
 * The endpoint a client connects to: the scope holding the server's own apps (not a standalone app's, such as
 * DashboardApp's), or the endpoint of the app `app` names.
 */
async function endpointScope(instance: FrontMcpInstance, app?: string): Promise<Scope> {
  if (app !== undefined) return instance.getAppScope(app) as Scope;
  const scope = instance.getPrimaryScope();
  if (!scope) {
    const { PublicMcpError } = await import('../errors/index.js');
    throw new PublicMcpError('No scopes initialized. Ensure at least one app is configured.', 'NO_SCOPES', 500);
  }
  return scope as Scope;
}

/**
 * Connect to a FrontMCP server with full options.
 *
 * Creates a DirectClient that connects via in-memory transport.
 * The client provides MCP operations with LLM-aware response formatting.
 *
 * @param config - FrontMCP configuration (same as @FrontMcp decorator)
 * @param options - Connection options including clientInfo, session, and authToken; `app` connects to the endpoint
 *   that app has of its own (each app's with `splitByApp`, a `standalone` app's otherwise) instead of the main one
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
 *
 * @example One app of a splitByApp server
 * ```typescript
 * const billing = await connect(SplitServerConfig, { app: 'billing' });
 * ```
 */
export async function connect(
  config: FrontMcpConfigInput,
  options?: ConnectOptions & { mode?: 'full' | 'cli'; app?: string },
): Promise<DirectClient> {
  const { DirectClientImpl } = await import('./direct-client.js');
  // Clients of the same config share its server, which is disposed when the last of them closes. The client is
  // counted before any await, so another client closing meanwhile cannot dispose the server under this one.
  const { cacheKey, instancePromise } = getInstance(config, options?.mode);
  instanceClients.set(instancePromise, (instanceClients.get(instancePromise) ?? 0) + 1);
  const leave = () => {
    const remaining = (instanceClients.get(instancePromise) ?? 1) - 1;
    instanceClients.set(instancePromise, remaining);
    return remaining;
  };
  const release = async () => {
    if (leave() > 0) return;
    if (instanceCache.get(cacheKey) === instancePromise) instanceCache.delete(cacheKey);
    const instance = await instancePromise;
    await Promise.all((instance.getScopes() as Scope[]).map((scope) => scope.dispose()));
  };
  try {
    const scope = await endpointScope(await instancePromise, options?.app);
    return await DirectClientImpl.create(scope, options, release);
  } catch (error) {
    leave();
    throw error;
  }
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
  instanceCache = new WeakMap<object, Promise<FrontMcpInstance>>();
}
