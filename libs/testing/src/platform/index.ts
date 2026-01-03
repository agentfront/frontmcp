/**
 * @file platform/index.ts
 * @description Platform utilities barrel export.
 *
 * Provides types and helpers for platform-specific E2E testing.
 *
 * @example
 * ```typescript
 * import {
 *   TestPlatformType,
 *   getPlatformClientInfo,
 *   getPlatformMetaNamespace,
 *   getForbiddenMetaPrefixes,
 * } from '@frontmcp/testing';
 *
 * // Get expected meta prefixes for a platform
 * const prefixes = getToolsListMetaPrefixes('openai');
 * // ['openai/']
 *
 * // Get forbidden prefixes (should NOT appear)
 * const forbidden = getForbiddenMetaPrefixes('openai');
 * // ['ui/', 'frontmcp/']
 * ```
 */

// Platform types
export type { TestPlatformType, PlatformMetaNamespace } from './platform-types';

// Platform type utilities
export {
  getPlatformMetaNamespace,
  getPlatformMimeType,
  isOpenAIPlatform,
  isExtAppsPlatform,
  isUiPlatform,
  getToolsListMetaPrefixes,
  getToolCallMetaPrefixes,
  getForbiddenMetaPrefixes,
} from './platform-types';

// Client info utilities
export type {
  TestClientInfo,
  TestClientCapabilities,
  ExperimentalCapabilities,
  McpAppsExtension,
} from './platform-client-info';

export {
  getPlatformClientInfo,
  buildUserAgent,
  getPlatformUserAgent,
  PLATFORM_DETECTION_PATTERNS,
  // Capability utilities for ext-apps platform detection
  MCP_APPS_EXTENSION_KEY,
  getPlatformCapabilities,
  requiresCapabilityDetection,
} from './platform-client-info';
