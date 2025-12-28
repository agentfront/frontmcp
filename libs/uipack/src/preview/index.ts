/**
 * Preview Handlers
 *
 * Platform-specific preview handlers for generating metadata.
 *
 * @packageDocumentation
 */

// Types
export type {
  Platform,
  AIPlatformType,
  DiscoveryPreviewOptions,
  ExecutionPreviewOptions,
  BuilderMockData,
  DiscoveryMeta,
  ExecutionMeta,
  PreviewHandler,
  OpenAIMetaFields,
  ClaudeMetaFields,
  FrontMCPMetaFields,
  UIMetaFields,
} from './types';

// Preview Handlers
export { OpenAIPreview } from './openai-preview';
export { ClaudePreview } from './claude-preview';
export { GenericPreview } from './generic-preview';

// ============================================
// Convenience Factory
// ============================================

import { OpenAIPreview } from './openai-preview';
import { ClaudePreview } from './claude-preview';
import { GenericPreview } from './generic-preview';
import type { Platform, PreviewHandler } from './types';

/**
 * Create a preview handler for the specified platform.
 *
 * @param platform - Target platform
 * @returns Preview handler instance
 *
 * @example
 * ```typescript
 * const preview = createPreviewHandler('openai');
 * const meta = preview.forExecution({ buildResult, input, output });
 * ```
 */
export function createPreviewHandler(platform: Platform): PreviewHandler {
  switch (platform) {
    case 'openai':
      return new OpenAIPreview();
    case 'claude':
      return new ClaudePreview();
    case 'generic':
      return new GenericPreview();
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Detect platform from client info or environment.
 *
 * @param clientInfo - Optional client info object
 * @returns Detected platform
 */
export function detectPlatform(clientInfo?: { name?: string; version?: string }): Platform {
  if (!clientInfo) {
    return 'generic';
  }

  const name = clientInfo.name?.toLowerCase() || '';

  if (name.includes('openai') || name.includes('chatgpt')) {
    return 'openai';
  }

  if (name.includes('claude') || name.includes('anthropic')) {
    return 'claude';
  }

  return 'generic';
}
