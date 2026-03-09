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
 * All platforms use `ui/*` meta keys per the MCP Apps specification.
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
 * All platforms now use `ui/*` keys per the MCP Apps specification.
 */
export type PlatformMetaNamespace = 'ui';

/**
 * Get the meta namespace for a platform type.
 * All platforms use the `ui` namespace.
 */
export function getPlatformMetaNamespace(platform: TestPlatformType): PlatformMetaNamespace {
  return 'ui';
}

/**
 * Get the expected MIME type for a platform.
 *
 * - OpenAI uses `text/html;profile=mcp-app`
 * - All other platforms use `text/html;profile=mcp-app`
 */
export function getPlatformMimeType(platform: TestPlatformType): string {
  return 'text/html;profile=mcp-app';
}

/**
 * Check if a platform uses OpenAI-specific meta keys.
 * Note: OpenAI now uses the standard ui/* namespace like all other platforms.
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
 * Check if a platform uses ui/* meta keys.
 * All platforms now use ui/* keys.
 */
export function isUiPlatform(platform: TestPlatformType): boolean {
  return true;
}

/**
 * Get all expected meta key prefixes for a platform's tools/list response.
 * All platforms use ui/* namespace.
 */
export function getToolsListMetaPrefixes(platform: TestPlatformType): string[] {
  return ['ui/'];
}

/**
 * Get all expected meta key prefixes for a platform's tool/call response.
 * All platforms use ui/* namespace.
 */
export function getToolCallMetaPrefixes(platform: TestPlatformType): string[] {
  return ['ui/'];
}

/**
 * Get forbidden meta key prefixes for a platform.
 * These prefixes should NOT appear in responses for the given platform.
 */
export function getForbiddenMetaPrefixes(platform: TestPlatformType): string[] {
  // No platform should have openai/* or frontmcp/* keys
  return ['openai/', 'frontmcp/'];
}
