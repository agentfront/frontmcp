/**
 * @file response-builder.ts
 * @description Tool response content builder for different serving modes and platforms.
 *
 * This module consolidates all the content formatting logic for tool responses,
 * handling the various output formats based on serving mode and platform capabilities.
 *
 * For platforms with useStructuredContent=true (all widget-supporting platforms):
 * - content: [{ type: 'text', text: '<!DOCTYPE html>...' }]  (single block with raw HTML)
 * - structuredContent: raw tool output (set by SDK, not this module)
 */

import type { WidgetServingMode } from '../types';
import type { AIPlatformType } from './platform-meta';
import { safeStringify } from '../utils';
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
   * The effective serving mode (after resolution from 'auto').
   */
  servingMode: Exclude<WidgetServingMode, 'auto'>;

  /**
   * Whether to use structuredContent format.
   * When true, raw HTML is returned in content and rawOutput goes to structuredContent.
   */
  useStructuredContent: boolean;

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
   * For structuredContent format: single TextContent with raw HTML.
   * For widget format: empty (widget reads from _meta).
   */
  content: TextContentBlock[];

  /**
   * Structured content containing raw tool output.
   * Set when useStructuredContent is true.
   */
  structuredContent?: unknown;

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
  format: 'structured-content' | 'widget' | 'markdown' | 'json-only';
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
 * // OpenAI/ext-apps: HTML goes directly in content
 * const openaiResult = buildToolResponseContent({
 *   rawOutput: { temperature: 72 },
 *   htmlContent: '<!DOCTYPE html>...',
 *   servingMode: 'inline',
 *   useStructuredContent: true,
 *   platformType: 'openai',
 * });
 * // result.content = [{ type: 'text', text: '<!DOCTYPE html>...' }]
 * // result.structuredContent = { temperature: 72 }
 * // result.format = 'structured-content'
 *
 * // Claude/generic platforms: JSON in content, HTML via _meta['ui/html']
 * const claudeResult = buildToolResponseContent({
 *   rawOutput: { temperature: 72 },
 *   htmlContent: '<!DOCTYPE html>...',
 *   servingMode: 'inline',
 *   useStructuredContent: true,
 *   platformType: 'claude',
 * });
 * // result.content = [{ type: 'text', text: '{"temperature":72}' }]
 * // result.structuredContent = { temperature: 72 }
 * // Note: HTML is set in _meta['ui/html'] by the call-tool flow, not this function
 * // result.format = 'structured-content'
 *
 * // Platform without widget support (gemini, unknown)
 * const geminiResult = buildToolResponseContent({
 *   rawOutput: { temperature: 72 },
 *   htmlContent: '<!DOCTYPE html>...',
 *   servingMode: 'inline',
 *   useStructuredContent: false,
 *   platformType: 'gemini',
 * });
 * // result.content = [{ type: 'text', text: '{"temperature":72}' }]
 * // result.format = 'json-only'
 * ```
 */
export function buildToolResponseContent(options: BuildToolResponseOptions): ToolResponseContent {
  const { rawOutput, htmlContent, servingMode, useStructuredContent, platformType } = options;

  // Static mode: return ONLY structured JSON data
  // Widget reads tool output from platform context (e.g., window.openai.toolOutput)
  if (servingMode === 'static') {
    return {
      content: [{ type: 'text', text: safeStringify(rawOutput) }],
      structuredContent: useStructuredContent ? rawOutput : undefined,
      contentCleared: false,
      format: 'json-only',
    };
  }

  // Hybrid mode: return structured JSON data (component payload handled separately)
  if (servingMode === 'hybrid') {
    return {
      content: [{ type: 'text', text: safeStringify(rawOutput) }],
      structuredContent: useStructuredContent ? rawOutput : undefined,
      contentCleared: false,
      format: 'json-only',
    };
  }

  // Inline mode: determine format based on platform capabilities

  // structuredContent format: raw HTML in content, raw output in structuredContent
  // Used by widget-supporting platforms
  if (useStructuredContent) {
    if (htmlContent) {
      // For OpenAI and ext-apps: put HTML directly in content (they render it)
      // For other platforms: put JSON in content, HTML stays in _meta['ui/html']
      const htmlInContent = platformType === 'openai' || platformType === 'ext-apps';

      if (htmlInContent) {
        // Single content block with raw HTML
        // structuredContent contains the raw tool output
        return {
          content: [{ type: 'text', text: htmlContent }],
          structuredContent: rawOutput,
          contentCleared: false,
          format: 'structured-content',
        };
      } else {
        // JSON in content for non-OpenAI/ext-apps platforms
        // Note: HTML is set in _meta['ui/html'] by the call-tool flow, not by this function
        // This gives unknown clients readable JSON while HTML is accessible via _meta
        return {
          content: [{ type: 'text', text: safeStringify(rawOutput) }],
          structuredContent: rawOutput,
          contentCleared: false,
          format: 'structured-content',
        };
      }
    }

    // Fallback: JSON only (no HTML available)
    return {
      content: [{ type: 'text', text: safeStringify(rawOutput) }],
      structuredContent: rawOutput,
      contentCleared: false,
      format: 'json-only',
    };
  }

  // Widget platforms (Claude, OpenAI, ext-apps, etc.) without structuredContent:
  // clear content, widget reads from _meta['ui/html']
  const supportsWidgets = platformSupportsWidgets(platformType);
  if (supportsWidgets) {
    return {
      content: [],
      contentCleared: true,
      format: 'widget',
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
