/**
 * @file css-to-theme.ts
 * @description Utility to convert user-provided CSS variables into Tailwind @theme block.
 *
 * When user provides a CSS string with --color-* variables in :root,
 * this utility extracts them and converts to a @theme block that
 * Tailwind v4 can process to create native utility classes.
 *
 * @example
 * ```typescript
 * import { cssToTailwindTheme } from '@frontmcp/uipack/theme';
 *
 * const userCss = `:root {
 *   --color-primary: #0556b2;
 *   --color-success: #10b981;
 *   --font-family: Inter;
 * }`;
 *
 * const { themeBlock, remainingCss } = cssToTailwindTheme(userCss);
 * // themeBlock: "@theme { --color-primary: #0556b2; --color-success: #10b981; }"
 * // remainingCss: CSS without --color-* variables
 * ```
 *
 * @module @frontmcp/uipack/theme/css-to-theme
 */

/**
 * Result of converting CSS to Tailwind theme.
 */
export interface CssToThemeResult {
  /**
   * The @theme block containing color variables.
   * Can be placed inside <style type="text/tailwindcss">.
   * Empty string if no color variables found.
   */
  themeBlock: string;

  /**
   * The remaining CSS after removing --color-* variables.
   * Can be placed in a regular <style> tag.
   */
  remainingCss: string;

  /**
   * Map of extracted color variable names to their values.
   * Useful for debugging or further processing.
   */
  colorVars: Map<string, string>;
}

/**
 * Regex to match CSS variable declarations with --color-* prefix.
 * Captures: [full match, variable name (without --), value]
 */
const COLOR_VAR_REGEX = /--(color-[\w-]+):\s*([^;]+);/g;

/**
 * Extract --color-* variables from user CSS and convert to Tailwind @theme block.
 *
 * This function:
 * 1. Finds all --color-* variable declarations in the CSS
 * 2. Creates a @theme block with these variables (for Tailwind v4 to process)
 * 3. Returns the remaining CSS without color variables
 *
 * The @theme block should be placed inside <style type="text/tailwindcss">,
 * which tells Tailwind v4 to:
 * - Create native utility classes (bg-primary, text-primary, etc.)
 * - Support opacity modifiers (bg-primary/10, text-success/50)
 *
 * @param userCss - CSS string containing :root with --color-* variables
 * @returns Object with themeBlock, remainingCss, and colorVars map
 *
 * @example
 * ```typescript
 * const result = cssToTailwindTheme(`:root {
 *   --color-primary: #0556b2;
 *   --font-size: 16px;
 * }`);
 *
 * // result.themeBlock: "@theme {\n  --color-primary: #0556b2;\n}"
 * // result.remainingCss: ":root {\n  --font-size: 16px;\n}"
 * ```
 */
/**
 * Maximum CSS input length for theme extraction (ReDoS prevention).
 */
const MAX_CSS_INPUT_LENGTH = 100000;

export function cssToTailwindTheme(userCss: string): CssToThemeResult {
  // Guard against ReDoS on large inputs
  if (userCss.length > MAX_CSS_INPUT_LENGTH) {
    return {
      themeBlock: '',
      remainingCss: userCss,
      colorVars: new Map(),
    };
  }

  const colorVars = new Map<string, string>();

  // Extract all --color-* variables
  const regex = new RegExp(COLOR_VAR_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(userCss)) !== null) {
    const varName = match[1]; // e.g., "color-primary"
    const value = match[2].trim();
    colorVars.set(varName, value);
  }

  // Remove --color-* declarations from original CSS
  const remainingCss = userCss.replace(COLOR_VAR_REGEX, '');

  // Build @theme block
  let themeBlock = '';
  if (colorVars.size > 0) {
    const lines = Array.from(colorVars.entries()).map(([name, value]) => `--${name}: ${value};`);
    themeBlock = `@theme {\n  ${lines.join('\n  ')}\n}`;
  }

  return {
    themeBlock,
    remainingCss,
    colorVars,
  };
}

/**
 * Build a complete Tailwind style block from user CSS.
 *
 * Combines the @theme block and remaining CSS into a single
 * <style type="text/tailwindcss"> block.
 *
 * @param userCss - CSS string containing :root with --color-* variables
 * @returns HTML style tag with @theme and remaining CSS
 *
 * @example
 * ```typescript
 * const styleTag = buildTailwindStyleBlock(userCss);
 * // Returns: <style type="text/tailwindcss">@theme {...}\n:root {...}</style>
 * ```
 */
export function buildTailwindStyleBlock(userCss: string): string {
  const { themeBlock, remainingCss } = cssToTailwindTheme(userCss);

  const parts = [themeBlock, remainingCss.trim()].filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  return `<style type="text/tailwindcss">\n${parts.join('\n\n')}\n</style>`;
}
