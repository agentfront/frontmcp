/**
 * Direct MCP Server Module
 *
 * Provides programmatic access to FrontMCP servers without HTTP/stdio transports.
 *
 * @module direct
 */

// ─────────────────────────────────────────────────────────────────────────────
// Client Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  DirectClient,
  ConnectOptions,
  LLMConnectOptions,
  SessionOptions,
  ClientInfo,
  LLMPlatform,
  // Skills types
  SearchSkillsOptions,
  SearchSkillsResult,
  SkillSearchResultItem,
  LoadSkillsOptions,
  LoadSkillsResult,
  LoadedSkillItem,
  ListSkillsOptions,
  ListSkillsResult,
  // Elicitation types
  ElicitationRequest,
  ElicitationResponse,
  ElicitationHandler,
  // Completion types
  CompleteOptions,
  CompleteResult,
  // Logging types
  McpLogLevel,
} from './client.types';

// ─────────────────────────────────────────────────────────────────────────────
// Connect Utilities
// ─────────────────────────────────────────────────────────────────────────────

export { connect, connectOpenAI, connectClaude, connectLangChain, connectVercelAI } from './connect';

// ─────────────────────────────────────────────────────────────────────────────
// Implementation (for advanced use)
// ─────────────────────────────────────────────────────────────────────────────

export { DirectClientImpl } from './direct-client';
export { detectPlatform, formatToolsForPlatform, formatResultForPlatform, PLATFORM_CLIENT_INFO } from './llm-platform';
export type { OpenAITool, ClaudeTool, LangChainTool, VercelAITool, VercelAITools } from './llm-platform';

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Direct Server (bypasses transport, invokes flows directly)
// ─────────────────────────────────────────────────────────────────────────────

export type { DirectMcpServer, DirectAuthContext, DirectCallOptions, DirectRequestMetadata } from './direct.types';

export { DirectMcpServerImpl } from './direct-server';
