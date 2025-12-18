/**
 * @file platform-types.ts
 * @description Platform type definitions for E2E testing.
 *
 * These types mirror the AIPlatformType from @frontmcp/ui/adapters
 * for use in testing without creating a hard dependency.
 *
 * @example
 * ```typescript
 * import { TestPlatformType } from '@frontmcp/testing';
 *
 * const platform: TestPlatformType = 'openai';
 * ```
 */

/**
 * Supported AI platform types for testing.
 *
 * - `openai`: OpenAI ChatGPT (uses openai/* meta keys)
 * - `ext-apps`: MCP Apps per SEP-1865 (uses ui/* meta keys)
 * - `claude`: Claude Desktop (uses frontmcp/* + ui/* keys)
 * - `cursor`: Cursor IDE (uses frontmcp/* + ui/* keys)
 * - `continue`: Continue Dev (uses frontmcp/* + ui/* keys)
 * - `cody`: Sourcegraph Cody (uses frontmcp/* + ui/* keys)
 * - `gemini`: Google Gemini (uses frontmcp/* + ui/* keys)
 * - `generic-mcp`: Generic MCP client (uses frontmcp/* + ui/* keys)
 * - `unknown`: Unknown platform (uses frontmcp/* + ui/* keys)
 */
export type TestPlatformType =
  | 'openai'
  | 'ext-apps'
  | 'claude'
  | 'cursor'
  | 'continue'
  | 'cody'
  | 'gemini'
  | 'generic-mcp'
  | 'unknown';

/**
 * Platform meta namespace used for tool responses.
 *
 * - `openai`: Uses `openai/*` keys only
 * - `ui`: Uses `ui/*` keys only (ext-apps per SEP-1865)
 * - `frontmcp`: Uses `frontmcp/*` + `ui/*` keys for compatibility
 */
export type PlatformMetaNamespace = 'openai' | 'ui' | 'frontmcp';

/**
 * Get the meta namespace for a platform type.
 */
export function getPlatformMetaNamespace(platform: TestPlatformType): PlatformMetaNamespace {
  switch (platform) {
    case 'openai':
      return 'openai';
    case 'ext-apps':
      return 'ui';
    default:
      return 'frontmcp';
  }
}

/**
 * Get the expected MIME type for a platform.
 *
 * - OpenAI uses `text/html+skybridge`
 * - All other platforms use `text/html+mcp`
 */
export function getPlatformMimeType(platform: TestPlatformType): string {
  return platform === 'openai' ? 'text/html+skybridge' : 'text/html+mcp';
}

/**
 * Check if a platform uses OpenAI-specific meta keys.
 */
export function isOpenAIPlatform(platform: TestPlatformType): boolean {
  return platform === 'openai';
}

/**
 * Check if a platform is ext-apps (SEP-1865 MCP Apps).
 */
export function isExtAppsPlatform(platform: TestPlatformType): boolean {
  return platform === 'ext-apps';
}

/**
 * Check if a platform uses FrontMCP meta keys (non-OpenAI, non-ext-apps).
 */
export function isFrontmcpPlatform(platform: TestPlatformType): boolean {
  return platform !== 'openai' && platform !== 'ext-apps';
}

/**
 * Get all expected meta key prefixes for a platform's tools/list response.
 */
export function getToolsListMetaPrefixes(platform: TestPlatformType): string[] {
  switch (platform) {
    case 'openai':
      return ['openai/'];
    case 'ext-apps':
      return ['ui/'];
    default:
      // Other platforms use frontmcp/* + ui/* for compatibility
      return ['frontmcp/', 'ui/'];
  }
}

/**
 * Get all expected meta key prefixes for a platform's tool/call response.
 */
export function getToolCallMetaPrefixes(platform: TestPlatformType): string[] {
  switch (platform) {
    case 'openai':
      return ['openai/'];
    case 'ext-apps':
      return ['ui/'];
    default:
      // Other platforms use frontmcp/* + ui/* for compatibility
      return ['frontmcp/', 'ui/'];
  }
}

/**
 * Get forbidden meta key prefixes for a platform.
 * These prefixes should NOT appear in responses for the given platform.
 */
export function getForbiddenMetaPrefixes(platform: TestPlatformType): string[] {
  switch (platform) {
    case 'openai':
      // OpenAI should NOT have ui/* or frontmcp/* keys
      return ['ui/', 'frontmcp/'];
    case 'ext-apps':
      // ext-apps should NOT have openai/* or frontmcp/* keys
      return ['openai/', 'frontmcp/'];
    default:
      // Other platforms should NOT have openai/* keys
      return ['openai/'];
  }
}
