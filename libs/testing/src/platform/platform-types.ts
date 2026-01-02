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
 * - `claude`: Claude Desktop (uses ui/* keys only)
 * - `cursor`: Cursor IDE (uses ui/* keys only)
 * - `continue`: Continue Dev (uses ui/* keys only)
 * - `cody`: Sourcegraph Cody (uses ui/* keys only)
 * - `gemini`: Google Gemini (uses ui/* keys only)
 * - `generic-mcp`: Generic MCP client (uses ui/* keys only)
 * - `unknown`: Unknown platform (uses ui/* keys only)
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
 * - `ui`: Uses `ui/*` keys only (all non-OpenAI platforms)
 */
export type PlatformMetaNamespace = 'openai' | 'ui';

/**
 * Get the meta namespace for a platform type.
 */
export function getPlatformMetaNamespace(platform: TestPlatformType): PlatformMetaNamespace {
  switch (platform) {
    case 'openai':
      return 'openai';
    default:
      // All non-OpenAI platforms use ui/* namespace
      return 'ui';
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
 * Check if a platform uses ui/* meta keys (non-OpenAI).
 */
export function isUiPlatform(platform: TestPlatformType): boolean {
  return platform !== 'openai';
}

/**
 * Get all expected meta key prefixes for a platform's tools/list response.
 */
export function getToolsListMetaPrefixes(platform: TestPlatformType): string[] {
  switch (platform) {
    case 'openai':
      return ['openai/'];
    default:
      // All non-OpenAI platforms use ui/* only
      return ['ui/'];
  }
}

/**
 * Get all expected meta key prefixes for a platform's tool/call response.
 */
export function getToolCallMetaPrefixes(platform: TestPlatformType): string[] {
  switch (platform) {
    case 'openai':
      return ['openai/'];
    default:
      // All non-OpenAI platforms use ui/* only
      return ['ui/'];
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
    default:
      // All non-OpenAI platforms should NOT have openai/* or frontmcp/* keys
      return ['openai/', 'frontmcp/'];
  }
}
