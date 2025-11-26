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
export const GITHUB_OPENAI_THEME: ThemeConfig = {
  name: 'github-openai',

  colors: {
    semantic: {
      // Primary: Near-black for main actions and branding
      primary: '#24292f',
      // Secondary: Medium gray for secondary elements
      secondary: '#57606a',
      // Accent: Blue for links, focus states, and highlights
      accent: '#0969da',
      // Status colors
      success: '#1a7f37', // GitHub green
      warning: '#9a6700', // Amber warning
      danger: '#cf222e', // GitHub red
      info: '#0969da', // Blue info
    },
    surface: {
      // Pure white background
      background: '#ffffff',
      // Light gray surface (GitHub code background style)
      surface: '#f6f8fa',
      // White elevated surfaces (modals, cards)
      elevated: '#ffffff',
      // Dark semi-transparent overlay
      overlay: 'rgba(27, 31, 36, 0.5)',
    },
    text: {
      // Near-black for primary text
      primary: '#24292f',
      // Gray for secondary/muted text
      secondary: '#57606a',
      // Light gray for disabled text
      disabled: '#8c959f',
      // White for text on dark backgrounds
      inverse: '#ffffff',
      // Blue for links
      link: '#0969da',
    },
    border: {
      // Light gray border (GitHub style)
      default: '#d0d7de',
      // Medium gray on hover
      hover: '#8c959f',
      // Blue focus ring
      focus: '#0969da',
      // Subtle divider
      divider: '#d8dee4',
    },
  },

  typography: {
    families: {
      // System UI font stack (GitHub/Apple style)
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
      // Monospace stack
      mono: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, "Liberation Mono", monospace',
    },
    sizes: {
      xs: '0.75rem', // 12px
      sm: '0.875rem', // 14px
      base: '1rem', // 16px
      lg: '1.125rem', // 18px
      xl: '1.25rem', // 20px
      '2xl': '1.5rem', // 24px
      '3xl': '1.875rem', // 30px
      '4xl': '2.25rem', // 36px
    },
    weights: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },

  radius: {
    none: '0',
    sm: '3px', // GitHub uses smaller radii
    md: '6px',
    lg: '8px',
    xl: '12px',
    '2xl': '16px',
    full: '9999px',
  },

  shadows: {
    // Subtle shadows with gray tones
    sm: '0 1px 0 rgba(27, 31, 36, 0.04)',
    md: '0 3px 6px rgba(140, 149, 159, 0.15)',
    lg: '0 8px 24px rgba(140, 149, 159, 0.2)',
    xl: '0 12px 28px rgba(140, 149, 159, 0.3)',
  },

  components: {
    button: {
      radius: '6px',
      paddingX: '16px',
      paddingY: '5px',
      fontSize: '14px',
      fontWeight: '500',
    },
    card: {
      radius: '6px',
      padding: '16px',
      shadow: '0 1px 0 rgba(27, 31, 36, 0.04)',
      borderWidth: '1px',
    },
    input: {
      radius: '6px',
      paddingX: '12px',
      paddingY: '5px',
      borderWidth: '1px',
      focusRingWidth: '3px',
    },
  },

  cdn: {
    fonts: {
      preconnect: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      stylesheets: [
        // System UI fonts don't need external stylesheets, but we include
        // Inter as an optional enhancement for consistent cross-platform rendering
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      ],
    },
    icons: {
      script: {
        url: 'https://cdn.jsdelivr.net/npm/lucide@0.294.0/dist/umd/lucide.min.js',
      },
    },
    scripts: {
      tailwind: 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
      htmx: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.7/htmx.min.js',
        integrity: 'sha512-T6VLg/MJYMbLTmQ8VLvonbWg8VOvmDhXcOvHzCwo6ShdGuUU5SEcp1IAPXL4k9lVoMi8gRXl5K/S/zh43Y9rJA==',
      },
      alpine: {
        url: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/cdn.min.js',
        integrity: 'sha384-6zY8MFQJ/EqS1r4RJl+7j8rvZPuBWpT0RzWf+IFcKhxqUzQNmJzA1X1VEVZhYaEz',
      },
    },
  },
};

/**
 * Export as DEFAULT_THEME for backwards compatibility
 */
export const DEFAULT_THEME = GITHUB_OPENAI_THEME;
