/**
 * @file ui-assertions.ts
 * @description UI-specific assertion helpers for testing tool UI responses
 *
 * The metadata keys used in these assertions align with the UIMetadata interface
 * from @frontmcp/ui/adapters. Key fields include:
 * - `ui/html`: Inline rendered HTML (universal)
 * - `ui/mimeType`: MIME type for the HTML content
 * - `openai/outputTemplate`: Resource URI for widget template (OpenAI)
 * - `openai/widgetAccessible`: Whether widget can invoke tools (OpenAI)
 *
 * @see {@link https://docs.agentfront.dev/docs/servers/tools#tool-ui | Tool UI Documentation}
 *
 * @example
 * ```typescript
 * import { UIAssertions } from '@frontmcp/testing';
 *
 * const result = await client.tools.call('my-tool', {});
 * const html = UIAssertions.assertRenderedUI(result);
 * UIAssertions.assertXssSafe(html);
 * UIAssertions.assertDataBinding(html, result.json(), ['location', 'temperature']);
 * ```
 */

import type { ToolResultWrapper } from '../client/mcp-test-client.types';
import type { TestPlatformType } from '../platform/platform-types';
import { getForbiddenMetaPrefixes, getToolCallMetaPrefixes, getPlatformMimeType } from '../platform/platform-types';

// Type-only reference: Metadata keys used below align with UIMetadata from @frontmcp/ui/adapters
// This is an optional peer dependency, so we don't import it directly

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Escape special regex metacharacters in a string.
 * This prevents user-provided tag/class names from being interpreted as regex patterns.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════════
// UI ASSERTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * UI-specific assertion helpers.
 * Use these for imperative-style assertions with detailed error messages.
 */
export const UIAssertions = {
  /**
   * Assert tool result has valid rendered UI HTML.
   * @param result - The tool result wrapper
   * @returns The rendered HTML string
   * @throws Error if no UI HTML found or if mdx-fallback detected
   */
  assertRenderedUI(result: ToolResultWrapper): string {
    const meta = result.raw._meta as Record<string, unknown> | undefined;

    if (!meta) {
      throw new Error('Expected tool result to have _meta, but _meta is undefined');
    }

    const html = meta['ui/html'];

    if (!html) {
      throw new Error('Expected tool result to have ui/html in _meta, but it is missing');
    }

    if (typeof html !== 'string') {
      throw new Error(`Expected ui/html to be a string, but got ${typeof html}`);
    }

    if (html.includes('mdx-fallback')) {
      throw new Error(
        'Got mdx-fallback instead of rendered HTML - MDX/React rendering failed. ' +
          'Check that @mdx-js/mdx is installed and the template syntax is valid.',
      );
    }

    return html;
  },

  /**
   * Assert HTML contains all expected bound values from tool output.
   * @param html - The rendered HTML string
   * @param output - The tool output object
   * @param keys - Array of keys whose values should appear in the HTML
   * @throws Error if any expected value is missing from the HTML
   */
  assertDataBinding(html: string, output: Record<string, unknown>, keys: string[]): void {
    const missingKeys: string[] = [];

    for (const key of keys) {
      const value = output[key];
      if (value === undefined || value === null) {
        continue; // Skip undefined/null values
      }

      const stringValue = String(value);
      if (!html.includes(stringValue)) {
        missingKeys.push(`${key}="${stringValue}"`);
      }
    }

    if (missingKeys.length > 0) {
      throw new Error(
        `Expected HTML to contain bound values for: ${missingKeys.join(', ')}. ` + 'Data binding may have failed.',
      );
    }
  },

  /**
   * Assert HTML is XSS-safe (no scripts, event handlers, or javascript: URIs).
   * @param html - The rendered HTML string
   * @throws Error if potential XSS vulnerabilities are detected
   */
  assertXssSafe(html: string): void {
    const vulnerabilities: string[] = [];

    if (/<script[\s>]/i.test(html)) {
      vulnerabilities.push('<script> tag detected');
    }

    if (/\son\w+\s*=/i.test(html)) {
      vulnerabilities.push('inline event handler detected (onclick, onerror, etc.)');
    }

    if (/javascript:/i.test(html)) {
      vulnerabilities.push('javascript: URI detected');
    }

    if (vulnerabilities.length > 0) {
      throw new Error(`Potential XSS vulnerabilities found: ${vulnerabilities.join('; ')}`);
    }
  },

  /**
   * Assert HTML has proper structure (not escaped raw content).
   * @param html - The rendered HTML string
   * @throws Error if HTML appears to be raw/unrendered content
   */
  assertProperHtmlStructure(html: string): void {
    // Check for escaped HTML entities that suggest content wasn't rendered
    if (html.includes('&lt;') && html.includes('&gt;')) {
      throw new Error(
        'HTML contains escaped HTML entities (&lt;, &gt;) - content was likely not rendered. ' +
          'Check that the template is being processed correctly.',
      );
    }

    // Check that there's at least one HTML tag
    if (!/<[a-z]/i.test(html)) {
      throw new Error('HTML contains no HTML tags - content may be plain text or rendering failed.');
    }
  },

  /**
   * Assert HTML contains a specific element.
   * @param html - The rendered HTML string
   * @param tag - The HTML tag name to look for
   * @throws Error if the element is not found
   */
  assertContainsElement(html: string, tag: string): void {
    // Escape regex metacharacters to prevent user input from breaking the regex
    const regex = new RegExp(`<${escapeRegex(tag)}[\\s>]`, 'i');
    if (!regex.test(html)) {
      throw new Error(`Expected HTML to contain <${tag}> element`);
    }
  },

  /**
   * Assert HTML contains a specific CSS class.
   * @param html - The rendered HTML string
   * @param className - The CSS class name to look for
   * @throws Error if the class is not found
   */
  assertHasCssClass(html: string, className: string): void {
    // Escape regex metacharacters to prevent user input from breaking the regex
    const classRegex = new RegExp(`class(?:Name)?\\s*=\\s*["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["']`, 'i');
    if (!classRegex.test(html)) {
      throw new Error(`Expected HTML to have CSS class "${className}"`);
    }
  },

  /**
   * Assert HTML does NOT contain specific content.
   * Useful for verifying custom components were rendered, not left as raw tags.
   * @param html - The rendered HTML string
   * @param content - The content that should NOT appear
   * @throws Error if the content is found
   */
  assertNotContainsRaw(html: string, content: string): void {
    if (html.includes(content)) {
      throw new Error(
        `HTML contains raw content "${content}" - this component may not have been rendered. ` +
          'Check that all custom components are properly passed to the renderer.',
      );
    }
  },

  /**
   * Assert that widget metadata is present in the result.
   * Checks for ui/html, openai/outputTemplate, or ui/mimeType.
   * @param result - The tool result wrapper
   * @throws Error if widget metadata is missing
   */
  assertWidgetMetadata(result: ToolResultWrapper): void {
    const meta = result.raw._meta as Record<string, unknown> | undefined;

    if (!meta) {
      throw new Error('Expected tool result to have _meta with widget metadata');
    }

    // Check for any widget-related metadata fields (aligned with toHaveWidgetMetadata matcher)
    const hasUiHtml = Boolean(meta['ui/html']);
    const hasOutputTemplate = Boolean(meta['openai/outputTemplate']);
    const hasMimeType = Boolean(meta['ui/mimeType']);

    if (!hasUiHtml && !hasOutputTemplate && !hasMimeType) {
      throw new Error('Expected _meta to have widget metadata (ui/html, openai/outputTemplate, or ui/mimeType)');
    }
  },

  /**
   * Comprehensive UI validation that runs all checks.
   * @param result - The tool result wrapper
   * @param boundKeys - Optional array of output keys to check for data binding
   * @returns The rendered HTML string
   * @throws Error if any validation fails
   */
  assertValidUI(result: ToolResultWrapper, boundKeys?: string[]): string {
    // 1. Get and validate HTML exists
    const html = UIAssertions.assertRenderedUI(result);

    // 2. Check HTML structure
    UIAssertions.assertProperHtmlStructure(html);

    // 3. Check XSS safety
    UIAssertions.assertXssSafe(html);

    // 4. Check data binding if keys provided
    if (boundKeys && boundKeys.length > 0) {
      try {
        const output = JSON.parse(result.text() || '{}');
        UIAssertions.assertDataBinding(html, output, boundKeys);
      } catch {
        // If we can't parse output, skip data binding check
      }
    }

    return html;
  },

  // ═══════════════════════════════════════════════════════════════════
  // PLATFORM META ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Assert tool result has correct meta keys for OpenAI platform.
   * Verifies openai/* keys are present and ui/*, frontmcp/* keys are absent.
   * @param result - The tool result wrapper
   * @throws Error if meta keys don't match OpenAI expectations
   */
  assertOpenAIMeta(result: ToolResultWrapper): void {
    UIAssertions.assertPlatformMeta(result, 'openai');
  },

  /**
   * Assert tool result has correct meta keys for ext-apps platform (SEP-1865).
   * Verifies ui/* keys are present and openai/*, frontmcp/* keys are absent.
   * @param result - The tool result wrapper
   * @throws Error if meta keys don't match ext-apps expectations
   */
  assertExtAppsMeta(result: ToolResultWrapper): void {
    UIAssertions.assertPlatformMeta(result, 'ext-apps');
  },

  /**
   * Assert tool result has correct meta keys for FrontMCP platforms (Claude, Cursor, etc.).
   * Verifies frontmcp/* + ui/* keys are present and openai/* keys are absent.
   * @param result - The tool result wrapper
   * @throws Error if meta keys don't match FrontMCP expectations
   */
  assertFrontmcpMeta(result: ToolResultWrapper): void {
    UIAssertions.assertPlatformMeta(result, 'claude');
  },

  /**
   * Assert tool result has correct meta keys for a specific platform.
   * @param result - The tool result wrapper
   * @param platform - The platform type to check for
   * @throws Error if meta keys don't match platform expectations
   */
  assertPlatformMeta(result: ToolResultWrapper, platform: TestPlatformType): void {
    const meta = result.raw._meta as Record<string, unknown> | undefined;

    if (!meta) {
      throw new Error(`Expected tool result to have _meta with platform meta for "${platform}"`);
    }

    const expectedPrefixes = getToolCallMetaPrefixes(platform);
    const forbiddenPrefixes = getForbiddenMetaPrefixes(platform);
    const metaKeys = Object.keys(meta);

    // Check for expected prefixes
    const hasExpectedPrefix = metaKeys.some((key) => expectedPrefixes.some((prefix) => key.startsWith(prefix)));

    if (!hasExpectedPrefix) {
      throw new Error(
        `Expected _meta to have keys with prefixes [${expectedPrefixes.join(', ')}] for platform "${platform}", ` +
          `but found: [${metaKeys.join(', ')}]`,
      );
    }

    // Check for forbidden prefixes
    const forbiddenKeys = metaKeys.filter((key) => forbiddenPrefixes.some((prefix) => key.startsWith(prefix)));

    if (forbiddenKeys.length > 0) {
      throw new Error(
        `Expected _meta NOT to have keys [${forbiddenKeys.join(', ')}] for platform "${platform}" ` +
          `(forbidden prefixes: [${forbiddenPrefixes.join(', ')}])`,
      );
    }
  },

  /**
   * Assert that no cross-namespace pollution exists in meta.
   * @param result - The tool result wrapper
   * @param expectedNamespace - The namespace that SHOULD be present
   * @throws Error if other namespaces are found
   */
  assertNoMixedNamespaces(result: ToolResultWrapper, expectedNamespace: string): void {
    const meta = result.raw._meta as Record<string, unknown> | undefined;

    if (!meta) {
      throw new Error(`Expected tool result to have _meta with namespace "${expectedNamespace}"`);
    }

    const metaKeys = Object.keys(meta);
    const wrongKeys = metaKeys.filter((key) => !key.startsWith(expectedNamespace));

    if (wrongKeys.length > 0) {
      throw new Error(
        `Expected _meta to ONLY have keys with namespace "${expectedNamespace}", ` +
          `but found: [${wrongKeys.join(', ')}]`,
      );
    }
  },

  /**
   * Assert that _meta has the correct MIME type for a platform.
   * @param result - The tool result wrapper
   * @param platform - The platform type to check for
   * @throws Error if MIME type doesn't match platform expectations
   */
  assertPlatformMimeType(result: ToolResultWrapper, platform: TestPlatformType): void {
    const meta = result.raw._meta as Record<string, unknown> | undefined;
    const expectedMimeType = getPlatformMimeType(platform);

    if (!meta) {
      throw new Error(`Expected tool result to have _meta with MIME type for platform "${platform}"`);
    }

    // Determine which key to check based on platform
    let mimeTypeKey: string;
    switch (platform) {
      case 'openai':
        mimeTypeKey = 'openai/mimeType';
        break;
      case 'ext-apps':
        mimeTypeKey = 'ui/mimeType';
        break;
      default:
        mimeTypeKey = 'frontmcp/mimeType';
    }

    const actualMimeType = meta[mimeTypeKey];

    if (actualMimeType !== expectedMimeType) {
      throw new Error(
        `Expected _meta["${mimeTypeKey}"] to be "${expectedMimeType}" for platform "${platform}", ` +
          `but got "${actualMimeType}"`,
      );
    }
  },

  /**
   * Assert that _meta has HTML in the correct platform-specific key.
   * @param result - The tool result wrapper
   * @param platform - The platform type to check for
   * @returns The HTML string
   * @throws Error if HTML is missing or in wrong key
   */
  assertPlatformHtml(result: ToolResultWrapper, platform: TestPlatformType): string {
    const meta = result.raw._meta as Record<string, unknown> | undefined;

    if (!meta) {
      throw new Error(`Expected tool result to have _meta with platform HTML for "${platform}"`);
    }

    // Determine which key to check based on platform
    let htmlKey: string;
    switch (platform) {
      case 'openai':
        htmlKey = 'openai/html';
        break;
      case 'ext-apps':
        htmlKey = 'ui/html';
        break;
      default:
        htmlKey = 'frontmcp/html';
    }

    const html = meta[htmlKey];

    if (typeof html !== 'string' || html.length === 0) {
      throw new Error(
        `Expected _meta["${htmlKey}"] to contain HTML for platform "${platform}", ` +
          `but ${html === undefined ? 'key not found' : `got ${typeof html}`}`,
      );
    }

    return html;
  },

  /**
   * Comprehensive platform meta validation.
   * @param result - The tool result wrapper
   * @param platform - The platform type to validate for
   * @returns The platform-specific HTML string
   * @throws Error if any platform-specific validation fails
   */
  assertValidPlatformMeta(result: ToolResultWrapper, platform: TestPlatformType): string {
    // 1. Check correct namespace keys
    UIAssertions.assertPlatformMeta(result, platform);

    // 2. Check MIME type
    UIAssertions.assertPlatformMimeType(result, platform);

    // 3. Get and return HTML
    return UIAssertions.assertPlatformHtml(result, platform);
  },
};
