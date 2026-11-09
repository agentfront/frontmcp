/**
 * Response Builder
 *
 * Formats MCP tool response content with UI data per the MCP Apps protocol.
 *
 * @packageDocumentation
 */

import type { AdapterPlatformType } from './serving-mode';

/**
 * Formatted tool response with UI content.
 */
export interface ToolResponseContent {
  /** Text content blocks */
  content: Array<{ type: 'text'; text: string }>;
  /** Structured content for clients that support it */
  structuredContent?: Record<string, unknown>;
  /** Response format hint */
  format?: string;
  /** Whether the text content was cleared in favor of structured */
  contentCleared?: boolean;
  /** UI metadata to merge into _meta */
  _meta?: Record<string, unknown>;
}

/**
 * Options for building a tool response with UI content.
 */
export interface BuildToolResponseContentOptions {
  /** Raw tool output */
  rawOutput: unknown;
  /** Rendered HTML content (if available) */
  htmlContent?: string;
  /** The effective serving mode */
  servingMode: string;
  /** Whether to include structuredContent */
  useStructuredContent: boolean;
  /** The platform type */
  platformType: AdapterPlatformType;
}

/**
 * Build a formatted tool response with UI content.
 *
 * Includes:
 * - `content`: Text summary of the output
 * - `structuredContent`: Raw output as structured data (when supported)
 * - `_meta`: Platform-specific HTML key with rendered content
 */
export function buildToolResponseContent(options: BuildToolResponseContentOptions): ToolResponseContent {
  const { rawOutput, htmlContent, servingMode, useStructuredContent, platformType } = options;

  // Build text summary
  const textSummary =
    typeof rawOutput === 'string'
      ? rawOutput
      : rawOutput !== null && rawOutput !== undefined
        ? JSON.stringify(rawOutput)
        : '';

  const result: ToolResponseContent = {
    content: [{ type: 'text', text: textSummary }],
  };

  // Add structured content when supported
  if (useStructuredContent && rawOutput !== null && rawOutput !== undefined) {
    const structured =
      typeof rawOutput === 'object' && !Array.isArray(rawOutput)
        ? (rawOutput as Record<string, unknown>)
        : { value: rawOutput };
    result.structuredContent = structured;
  }

  // Add HTML content via platform-specific _meta key
  if (htmlContent && servingMode === 'inline') {
    const htmlKey = 'ui/html';
    result._meta = {
      [htmlKey]: htmlContent,
    };
    result.format = 'html';
  }

  return result;
}

/**
 * The second text block of a "dual payload" (`ui.htmlResponsePrefix`): the prefix, a colon, and the
 * page in an `html` code fence, for a client that renders no widget but shows HTML from a code
 * block. The fence is longer than any run of backticks in the page, so the page can't close it.
 *
 * @example buildHtmlResponseText('Here is the weather dashboard', html)
 * // 'Here is the weather dashboard:\n\n```html\n<!DOCTYPE html>…\n```'
 */
export function buildHtmlResponseText(prefix: string, html: string): string {
  const longestRun = Math.max(0, ...(html.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${prefix}:\n\n${fence}html\n${html}\n${fence}`;
}
