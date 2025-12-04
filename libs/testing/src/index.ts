/**
 * @file index.ts
 * @description Main barrel exports for @frontmcp/testing
 *
 * @example Quick Start with Fixtures
 * ```typescript
 * import { test, expect } from '@frontmcp/testing';
 *
 * test.use({
 *   server: './src/main.ts',
 *   port: 3003,
 * });
 *
 * test('server exposes tools', async ({ mcp }) => {
 *   const tools = await mcp.tools.list();
 *   expect(tools).toContainTool('my-tool');
 * });
 *
 * test('tool execution works', async ({ mcp }) => {
 *   const result = await mcp.tools.call('my-tool', { input: 'test' });
 *   expect(result).toBeSuccessful();
 * });
 * ```
 *
 * @example Manual Client Usage
 * ```typescript
 * import { McpTestClient, TestServer } from '@frontmcp/testing';
 *
 * const server = await TestServer.start({ command: 'npx tsx src/main.ts' });
 * const client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
 *   .withTransport('streamable-http')
 *   .buildAndConnect();
 *
 * const tools = await client.tools.list();
 * console.log(tools);
 *
 * await client.disconnect();
 * await server.stop();
 * ```
 */

// ═══════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════

export { McpTestClient } from './client/mcp-test-client';
export { McpTestClientBuilder } from './client/mcp-test-client.builder';
export type {
  McpTestClientConfig,
  McpResponse,
  McpErrorInfo,
  TestTransportType,
  TestAuthConfig,
  ToolResultWrapper,
  ResourceContentWrapper,
  PromptResultWrapper,
  LogEntry,
  LogLevel,
  RequestTrace,
  NotificationEntry,
  ProgressUpdate,
  SessionInfo,
  AuthState,
} from './client/mcp-test-client.types';

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT
// ═══════════════════════════════════════════════════════════════════

export type { McpTransport, TransportConfig, TransportState } from './transport/transport.interface';
export { StreamableHttpTransport } from './transport/streamable-http.transport';

// ═══════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════

export { TestTokenFactory } from './auth/token-factory';
export type { CreateTokenOptions, TokenFactoryOptions } from './auth/token-factory';
export { AuthHeaders } from './auth/auth-headers';
export { TestUsers, createTestUser } from './auth/user-fixtures';
export type { TestUserFixture } from './auth/user-fixtures';

// ═══════════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════════

export { TestServer } from './server/test-server';
export type { TestServerOptions, TestServerInfo } from './server/test-server';

// ═══════════════════════════════════════════════════════════════════
// ASSERTIONS
// ═══════════════════════════════════════════════════════════════════

export {
  McpAssertions,
  containsTool,
  containsResource,
  containsResourceTemplate,
  containsPrompt,
  isSuccessful,
  isError,
  hasTextContent,
  hasMimeType,
} from './assertions/mcp-assertions';

// ═══════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════

export {
  TestClientError,
  ConnectionError,
  TimeoutError,
  McpProtocolError,
  ServerStartError,
  AssertionError,
} from './errors/index';

// ═══════════════════════════════════════════════════════════════════
// RE-EXPORTS FROM MCP SDK
// ═══════════════════════════════════════════════════════════════════

export type {
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  GetPromptResult,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  // JSON-RPC types
  JSONRPCRequest,
  JSONRPCResponse,
} from './client/mcp-test-client.types';

// ═══════════════════════════════════════════════════════════════════
// FIXTURES (Primary API)
// ═══════════════════════════════════════════════════════════════════

export { test } from './fixtures';
export type {
  TestConfig,
  TestFixtures,
  AuthFixture,
  ServerFixture,
  TestFn,
  TestWithFixtures,
  TestUser,
} from './fixtures';

// ═══════════════════════════════════════════════════════════════════
// EXPECT (Primary API)
// ═══════════════════════════════════════════════════════════════════

// Export the pre-typed expect with MCP matchers (Playwright-style approach)
// This provides proper typing without relying on global namespace augmentation
export { expect } from './expect';

// ═══════════════════════════════════════════════════════════════════
// CUSTOM MATCHERS
// ═══════════════════════════════════════════════════════════════════

export { mcpMatchers } from './matchers';
export type { McpMatchers } from './matchers';

// ═══════════════════════════════════════════════════════════════════
// INTERCEPTORS & MOCKING
// ═══════════════════════════════════════════════════════════════════

export { DefaultMockRegistry, DefaultInterceptorChain, mockResponse, interceptors } from './interceptor';

export type {
  InterceptorContext,
  InterceptorResult,
  RequestInterceptor,
  ResponseInterceptorContext,
  ResponseInterceptorResult,
  ResponseInterceptor,
  MockDefinition,
  MockRegistry,
  MockHandle,
  InterceptorChain,
} from './interceptor';

// ═══════════════════════════════════════════════════════════════════
// HTTP MOCKING (for offline testing)
// ═══════════════════════════════════════════════════════════════════

export { httpMock, httpResponse } from './http-mock';

export type {
  HttpMethod,
  HttpRequestMatcher,
  HttpMockResponse,
  HttpMockDefinition,
  HttpRequestInfo,
  HttpMockHandle,
  HttpInterceptor,
  HttpMockManager,
} from './http-mock';

// ═══════════════════════════════════════════════════════════════════
// UI TESTING
// ═══════════════════════════════════════════════════════════════════

export { uiMatchers, UIAssertions } from './ui';
