/**
 * SDK Re-exports
 *
 * Re-exports browser-safe APIs from @frontmcp/sdk so consumers
 * can import everything from `@frontmcp/react` without extra deps.
 *
 * Bundlers resolve @frontmcp/sdk to the browser build via the
 * "browser" export condition in its package.json.
 */

// Decorators and context classes for defining entries
export { Tool, ToolContext } from '@frontmcp/sdk';
export { Resource, ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
export { Prompt, PromptContext } from '@frontmcp/sdk';

// Direct server factory + connect helpers + registry
export {
  create,
  clearCreateCache,
  connect,
  connectOpenAI,
  connectClaude,
  connectLangChain,
  connectVercelAI,
  ServerRegistry,
} from '@frontmcp/sdk';

// LLM platform utilities
export { detectPlatform, formatToolsForPlatform, formatResultForPlatform, PLATFORM_CLIENT_INFO } from '@frontmcp/sdk';

// Types
export type {
  DirectMcpServer,
  DirectClient,
  CreateConfig,
  ConnectOptions,
  LLMConnectOptions,
  SessionOptions,
  ClientInfo,
  LLMPlatform,
  DirectAuthContext,
  DirectCallOptions,
  OpenAITool,
  ClaudeTool,
  LangChainTool,
  VercelAITool,
  VercelAITools,
} from '@frontmcp/sdk';

export type { GetPromptResult } from '@frontmcp/sdk';
