/**
 * Dual-Payload Builder for Claude Artifacts
 *
 * Creates the "Dual-Payload" response format for Claude clients:
 * - Block 0: Pure JSON stringified data (for programmatic parsing)
 * - Block 1: Markdown-wrapped HTML (```html...```) for visual rendering
 *
 * This format enables Claude to:
 * 1. Parse structured data for reasoning
 * 2. Generate an HTML Artifact for visual display
 *
 * @packageDocumentation
 */

// ============================================
// Types
// ============================================

/**
 * Text content block for MCP responses.
 * Matches the MCP TextContent type structure.
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Options for building a dual-payload response.
 */
export interface DualPayloadOptions {
  /**
   * Structured data to include in the first content block.
   * Will be JSON stringified.
   */
  data: unknown;

  /**
   * Complete HTML document for the second content block.
   * Should be a full HTML document (<!DOCTYPE html>...).
   */
  html: string;

  /**
   * Prefix text shown before the HTML code block.
   * @default 'Here is the visual result'
   * @example 'Here is the weather dashboard'
   */
  htmlPrefix?: string;
}

/**
 * Result of building a dual-payload response.
 */
export interface DualPayloadResult {
  /**
   * Array of two TextContent blocks:
   * - [0]: Pure JSON data
   * - [1]: Markdown-wrapped HTML
   */
  content: [TextContent, TextContent];
}

// ============================================
// Constants
// ============================================

/**
 * Default prefix for the HTML content block.
 */
export const DEFAULT_HTML_PREFIX = 'Here is the visual result';

// ============================================
// Main Builder Function
// ============================================

/**
 * Build a dual-payload response for Claude clients.
 *
 * Creates two TextContent blocks:
 * 1. Pure JSON stringified data (for programmatic parsing)
 * 2. Markdown-wrapped HTML with descriptive prefix (for Artifact rendering)
 *
 * @example Basic usage
 * ```typescript
 * import { buildDualPayload } from '@frontmcp/ui/adapters';
 *
 * const result = buildDualPayload({
 *   data: { stock: 'AAPL', price: 150.25 },
 *   html: '<!DOCTYPE html><html>...</html>',
 * });
 *
 * // result.content[0].text = '{"stock":"AAPL","price":150.25}'
 * // result.content[1].text = 'Here is the visual result:\n\n```html\n<!DOCTYPE html>...\n```'
 * ```
 *
 * @example Custom prefix
 * ```typescript
 * const result = buildDualPayload({
 *   data: { temperature: 72 },
 *   html: weatherHtml,
 *   htmlPrefix: 'Here is the weather dashboard',
 * });
 * // result.content[1].text starts with 'Here is the weather dashboard:\n\n```html\n...'
 * ```
 *
 * @example Usage in tool response
 * ```typescript
 * // In call-tool.flow.ts finalize stage
 * if (outputMode === 'dual-payload') {
 *   const { content } = buildDualPayload({
 *     data: rawOutput,
 *     html: renderedHtml,
 *     htmlPrefix: tool.metadata.ui?.htmlResponsePrefix,
 *   });
 *   result.content = content;
 * }
 * ```
 */
export function buildDualPayload(options: DualPayloadOptions): DualPayloadResult {
  const { data, html, htmlPrefix = DEFAULT_HTML_PREFIX } = options;

  // Block A (index 0): Pure JSON data
  // This is for programmatic parsing by Claude or other systems
  const dataBlock: TextContent = {
    type: 'text',
    text: safeStringify(data),
  };

  // Block B (index 1): Markdown-wrapped HTML
  // This enables Claude to create an HTML Artifact for visual display
  // Escape any backticks in the HTML to prevent breaking the code fence
  const escapedHtml = escapeCodeFence(html);
  const htmlBlock: TextContent = {
    type: 'text',
    text: `${htmlPrefix}:\n\n\`\`\`html\n${escapedHtml}\n\`\`\``,
  };

  return {
    content: [dataBlock, htmlBlock],
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Safely stringify data to JSON.
 * Returns '{}' for undefined/null, handles circular references gracefully.
 */
function safeStringify(data: unknown): string {
  if (data === undefined || data === null) {
    return '{}';
  }

  try {
    return JSON.stringify(data);
  } catch {
    // Handle circular references or other stringify errors
    return '{"error":"Unable to serialize data"}';
  }
}

/**
 * Escape backticks in HTML to prevent breaking the markdown code fence.
 * Uses longer delimiter if needed (though rare in HTML).
 */
function escapeCodeFence(html: string): string {
  // If HTML contains triple backticks, we need to escape or use longer fence
  // This is rare in practice, but we handle it for safety
  if (html.includes('```')) {
    // Replace triple backticks with HTML entity equivalent
    return html.replace(/```/g, '&#96;&#96;&#96;');
  }
  return html;
}

// ============================================
// Validation Helpers
// ============================================

/**
 * Check if a response is a valid dual-payload structure.
 * Useful for testing and validation.
 */
export function isDualPayload(response: unknown): response is DualPayloadResult {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const r = response as Record<string, unknown>;
  const content = r['content'];

  if (!Array.isArray(content) || content.length !== 2) {
    return false;
  }

  const [block0, block1] = content as Array<Record<string, unknown>>;

  // Block 0 should be TextContent with JSON
  if (!block0 || block0['type'] !== 'text' || typeof block0['text'] !== 'string') {
    return false;
  }

  // Block 1 should be TextContent with markdown-wrapped HTML
  if (!block1 || block1['type'] !== 'text' || typeof block1['text'] !== 'string') {
    return false;
  }

  // Block 1 should contain HTML code fence
  if (!(block1['text'] as string).includes('```html')) {
    return false;
  }

  return true;
}

/**
 * Extract data and HTML from a dual-payload response.
 * Useful for testing and debugging.
 */
export function parseDualPayload(response: DualPayloadResult): {
  data: unknown;
  html: string;
  prefix: string;
} {
  const [dataBlock, htmlBlock] = response.content;

  // Parse JSON data from block 0
  let data: unknown;
  try {
    data = JSON.parse(dataBlock.text);
  } catch {
    data = null;
  }

  // Extract HTML from block 1
  const htmlMatch = htmlBlock.text.match(/```html\n([\s\S]*?)\n```/);
  const html = htmlMatch ? htmlMatch[1] : '';

  // Extract prefix (everything before the code fence)
  const prefixMatch = htmlBlock.text.match(/^(.*?):\n\n```html/);
  const prefix = prefixMatch ? prefixMatch[1] : DEFAULT_HTML_PREFIX;

  return { data, html, prefix };
}
