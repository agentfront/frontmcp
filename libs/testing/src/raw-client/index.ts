/**
 * Raw MCP protocol client re-exports for low-level e2e testing.
 * For programmatic access, prefer connect()/connectOpenAI() from @frontmcp/sdk.
 */
export { Client as McpClient } from '@frontmcp/protocol';
export { StdioClientTransport as McpStdioClientTransport } from '@frontmcp/protocol';
