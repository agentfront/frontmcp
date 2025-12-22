/**
 * @file github-openai.ts
 * @description Default theme with GitHub/OpenAI gray-black aesthetic.
 *
 * This is the new default theme for @frontmcp/ui, featuring a monochromatic
 * gray-black color palette inspired by GitHub and OpenAI's design systems.
 * Includes system UI font stack, smaller border radii, and subtle shadows.
 *
 * @example
 * ```typescript
 * import { GITHUB_OPENAI_THEME, createTheme } from '@frontmcp/ui';
 *
 * // Use directly
 * baseLayout(content, { theme: GITHUB_OPENAI_THEME });
 *
 * // Or extend
 * const myTheme = createTheme({
 *   colors: { semantic: { primary: '#0969da' } },
 * });
 * ```
 *
 * @module @frontmcp/ui/theme/presets/github-openai
 */
import type { ThemeConfig } from '../theme';
/**
 * GitHub/OpenAI inspired default theme
 *
 * Color palette:
 * - Primary: #24292f (near-black for primary actions)
 * - Secondary: #57606a (medium gray for secondary)
 * - Accent: #0969da (blue accent for links/highlights)
 * - Success: #1a7f37 (GitHub green)
 * - Warning: #9a6700 (amber warning)
 * - Danger: #cf222e (GitHub red)
 *
 * Typography:
 * - System UI font stack (Apple/GitHub style)
 * - Monospace: ui-monospace, SFMono-Regular
 *
 * Design tokens:
 * - Smaller border radii (6px default)
 * - Subtle shadows with gray tones
 * - Light gray borders (#d0d7de)
 */
export declare const GITHUB_OPENAI_THEME: ThemeConfig;
/**
 * Export as DEFAULT_THEME for backwards compatibility
 */
export declare const DEFAULT_THEME: ThemeConfig;
//# sourceMappingURL=github-openai.d.ts.map
