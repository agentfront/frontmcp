/**
 * Hybrid Mode Data Injection Utilities
 *
 * Provides utilities for injecting data into pre-built HTML shells
 * without requiring re-transpilation of the component code.
 *
 * @packageDocumentation
 */

// ============================================
// Constants
// ============================================

/**
 * Placeholder marker for hybrid mode.
 * Used as a string that callers can replace with actual JSON data.
 */
export const HYBRID_DATA_PLACEHOLDER = '__FRONTMCP_OUTPUT_PLACEHOLDER__';

/**
 * Placeholder for tool input injection.
 */
export const HYBRID_INPUT_PLACEHOLDER = '__FRONTMCP_INPUT_PLACEHOLDER__';

// ============================================
// Helper Functions
// ============================================

/**
 * Inject data into a hybrid mode HTML shell.
 * Replaces the placeholder with actual JSON data.
 *
 * This function is designed for high performance - it only does a string
 * replacement, avoiding any re-transpilation of component code.
 *
 * @param shell - HTML shell from bundleToStaticHTML with buildMode='hybrid'
 * @param data - Data to inject (will be JSON.stringify'd)
 * @param placeholder - Placeholder to replace (default: HYBRID_DATA_PLACEHOLDER)
 * @returns HTML with data injected
 *
 * @example
 * ```typescript
 * import { injectHybridData } from '@frontmcp/uipack/build';
 *
 * // Build shell once (cached)
 * const result = await bundler.bundleToStaticHTML({
 *   source: myComponent,
 *   toolName: 'my_tool',
 *   buildMode: 'hybrid',
 * });
 *
 * // Store the shell for reuse
 * const cachedShell = result.html;
 *
 * // On each tool call, just inject data (no re-transpiling!)
 * const html1 = injectHybridData(cachedShell, { temperature: 72 });
 * const html2 = injectHybridData(cachedShell, { temperature: 85 });
 * ```
 */
export function injectHybridData(
  shell: string,
  data: unknown,
  placeholder: string = HYBRID_DATA_PLACEHOLDER,
): string {
  let jsonData: string;
  try {
    // Double-encode: the data is inside a string literal in JS
    // So we need to escape the JSON for embedding in a string
    jsonData = JSON.stringify(JSON.stringify(data));
    // Remove outer quotes since we're replacing inside a string literal
    jsonData = jsonData.slice(1, -1);
  } catch {
    jsonData = 'null';
  }

  return shell.replace(placeholder, jsonData);
}

/**
 * Inject both input and output data into a hybrid mode HTML shell.
 * Replaces both input and output placeholders.
 *
 * @param shell - HTML shell with both placeholders
 * @param input - Input data to inject
 * @param output - Output data to inject
 * @returns HTML with both input and output injected
 *
 * @example
 * ```typescript
 * const html = injectHybridDataFull(cachedShell, { query: 'NYC' }, { temperature: 72 });
 * ```
 */
export function injectHybridDataFull(
  shell: string,
  input: unknown,
  output: unknown,
): string {
  let result = shell;
  result = injectHybridData(result, output, HYBRID_DATA_PLACEHOLDER);
  result = injectHybridData(result, input, HYBRID_INPUT_PLACEHOLDER);
  return result;
}

/**
 * Check if an HTML string is a hybrid mode shell (contains output placeholder).
 *
 * @param html - HTML string to check
 * @param placeholder - Placeholder to look for (default: HYBRID_DATA_PLACEHOLDER)
 * @returns true if the HTML contains the placeholder
 *
 * @example
 * ```typescript
 * import { isHybridShell } from '@frontmcp/uipack/build';
 *
 * if (isHybridShell(cachedHtml)) {
 *   // Need to inject data before serving
 *   const html = injectHybridData(cachedHtml, toolOutput);
 * }
 * ```
 */
export function isHybridShell(
  html: string,
  placeholder: string = HYBRID_DATA_PLACEHOLDER,
): boolean {
  return html.includes(placeholder);
}

/**
 * Check if an HTML string needs input injection.
 *
 * @param html - HTML string to check
 * @returns true if the HTML contains the input placeholder
 */
export function needsInputInjection(html: string): boolean {
  return html.includes(HYBRID_INPUT_PLACEHOLDER);
}

/**
 * Get placeholders present in an HTML shell.
 *
 * @param html - HTML string to check
 * @returns Object indicating which placeholders are present
 */
export function getHybridPlaceholders(html: string): {
  hasOutput: boolean;
  hasInput: boolean;
} {
  return {
    hasOutput: html.includes(HYBRID_DATA_PLACEHOLDER),
    hasInput: html.includes(HYBRID_INPUT_PLACEHOLDER),
  };
}
