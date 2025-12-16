/**
 * @file response-builder.ts
 * @description Tool response content builder for different serving modes and platforms.
 *
 * This module consolidates all the content formatting logic for tool responses,
 * handling the various output formats based on serving mode and platform capabilities.
 */

import type { WidgetServingMode } from '../types';
import type { AIPlatformType } from './platform-meta';
import { buildDualPayload } from './dual-payload';
import { safeStringify } from '../utils/safe-stringify';
import { platformSupportsWidgets } from './serving-mode';

// ============================================
// Types
// ============================================

/**
 * Text content block for MCP responses.
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/**
 * Options for building tool response content.
 */
export interface BuildToolResponseOptions {
  /**
   * The raw output from the tool execution.
   */
  rawOutput: unknown;

  /**
   * Rendered HTML content (for inline mode).
   */
  htmlContent?: string;

  /**
   * Prefix text for dual-payload HTML block.
   * @default 'Here is the visual result'
   */
  htmlPrefix?: string;

  /**
   * The effective serving mode (after resolution from 'auto').
   */
  servingMode: Exclude<WidgetServingMode, 'auto'>;

  /**
   * Whether to use dual-payload format (Claude).
   */
  useDualPayload: boolean;

  /**
   * The detected platform type.
   */
  platformType: AIPlatformType;
}

/**
 * Result of building tool response content.
 */
export interface ToolResponseContent {
  /**
   * The content blocks to include in the response.
   * Empty array means widget platform will display from _meta.
   */
  content: TextContentBlock[];

  /**
   * Metadata to merge into result._meta.
   */
  meta?: Record<string, unknown>;

  /**
   * Whether the content was cleared (widget platform handles display).
   */
  contentCleared: boolean;

  /**
   * Format used for the response.
   */
  format: 'widget' | 'dual-payload' | 'markdown' | 'json-only';
}

// ============================================
// Response Content Builder
// ============================================

/**
 * Build the content blocks for a tool response based on serving mode and platform.
 *
 * This function consolidates the content formatting logic that was previously
 * spread across the call-tool.flow.ts finalize stage.
 *
 * @example
 * ```typescript
 * // Widget platform (OpenAI)
 * const result = buildToolResponseContent({
 *   rawOutput: { temperature: 72 },
 *   htmlContent: '<div>...</div>',
 *   servingMode: 'inline',
 *   useDualPayload: false,
 *   platformType: 'openai',
 * });
 * // result.content = []
 * // result.contentCleared = true
 * // result.format = 'widget'
 *
 * // Claude (dual-payload)
 * const claudeResult = buildToolResponseContent({
 *   rawOutput: { temperature: 72 },
 *   htmlContent: '<div>...</div>',
 *   servingMode: 'inline',
 *   useDualPayload: true,
 *   platformType: 'claude',
 * });
 * // result.content = [{ type: 'text', text: '{"temperature":72}' }, { type: 'text', text: '...' }]
 * // result.format = 'dual-payload'
 * ```
 */
export function buildToolResponseContent(options: BuildToolResponseOptions): ToolResponseContent {
  const { rawOutput, htmlContent, htmlPrefix, servingMode, useDualPayload, platformType } = options;

  // Static mode: return ONLY structured JSON data
  // Widget reads tool output from platform context (e.g., window.openai.toolOutput)
  if (servingMode === 'static') {
    return {
      content: [{ type: 'text', text: safeStringify(rawOutput) }],
      contentCleared: false,
      format: 'json-only',
    };
  }

  // Hybrid mode: return structured JSON data (component payload handled separately)
  if (servingMode === 'hybrid') {
    return {
      content: [{ type: 'text', text: safeStringify(rawOutput) }],
      contentCleared: false,
      format: 'json-only',
    };
  }

  // Inline mode: determine format based on platform capabilities
  const supportsWidgets = platformSupportsWidgets(platformType);

  if (supportsWidgets) {
    // Widget platforms: clear content, widget reads from _meta['ui/html']
    return {
      content: [],
      contentCleared: true,
      format: 'widget',
    };
  }

  if (useDualPayload) {
    // Claude dual-payload format:
    // Block 0: Pure JSON data (for programmatic parsing)
    // Block 1: Markdown-wrapped HTML (for Artifact rendering)
    if (htmlContent) {
      const dualPayload = buildDualPayload({
        data: rawOutput,
        html: htmlContent,
        htmlPrefix: htmlPrefix || 'Here is the visual result',
      });
      return {
        content: dualPayload.content,
        contentCleared: false,
        format: 'dual-payload',
      };
    }

    // Fallback: JSON only (no HTML available)
    return {
      content: [{ type: 'text', text: safeStringify(rawOutput) }],
      contentCleared: false,
      format: 'json-only',
    };
  }

  // Other platforms: combined markdown format
  if (htmlContent) {
    return {
      content: [
        {
          type: 'text',
          text: `## Data\n\`\`\`json\n${safeStringify(
            rawOutput,
            2,
          )}\n\`\`\`\n\n## Visual Template (for artifact rendering)\n\`\`\`html\n${htmlContent}\n\`\`\``,
        },
      ],
      contentCleared: false,
      format: 'markdown',
    };
  }

  // Fallback: JSON only
  return {
    content: [{ type: 'text', text: safeStringify(rawOutput, 2) }],
    contentCleared: false,
    format: 'json-only',
  };
}
