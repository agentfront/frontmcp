// file: libs/browser/src/entries/built-in/theme.resource.ts
/**
 * Theme MCP Resources
 *
 * Built-in resources for exposing theme information to AI agents:
 * - theme://current - Current theme mode and resolved theme
 * - theme://tokens - All design tokens for the current theme
 */

import { BrowserResourceEntry } from '../browser-resource.entry';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { DesignTokens, ThemeMode, ResolvedTheme } from '../../theme';
import { LIGHT_TOKENS, DARK_TOKENS } from '../../theme';

/**
 * Base class for theme resources with common implementations
 */
abstract class BaseThemeResource extends BrowserResourceEntry {
  // Simplified implementations for browser-only resources
  create(): never {
    throw new Error('Theme resources use read() directly');
  }

  parseOutput(result: ReadResourceResult): ReadResourceResult {
    return result;
  }

  safeParseOutput(
    raw: ReadResourceResult,
  ): { success: true; data: ReadResourceResult } | { success: false; error: Error } {
    return { success: true, data: raw };
  }

  matchUri(uri: string): { matches: boolean; params: Record<string, string> } {
    const ctor = this.constructor as { metadata?: { uri?: string } };
    return { matches: uri === ctor.metadata?.uri, params: {} };
  }

  async initialize(): Promise<void> {
    // No-op for browser resources
  }
}

/**
 * Theme state stored in the browser store
 */
export interface ThemeStoreState {
  theme?: {
    mode: ThemeMode;
    resolvedTheme: ResolvedTheme;
    systemPrefersDark: boolean;
    customLightTokens?: Partial<DesignTokens>;
    customDarkTokens?: Partial<DesignTokens>;
  };
}

/**
 * Current Theme Resource
 *
 * Exposes the current theme configuration at theme://current
 *
 * @example AI agent reading current theme
 * ```
 * Read resource: theme://current
 * Response: { mode: "system", resolvedTheme: "dark", systemPrefersDark: true }
 * ```
 */
export class CurrentThemeResource extends BaseThemeResource {
  static readonly metadata = {
    name: 'current-theme',
    uri: 'theme://current',
    description:
      'Current theme mode and resolved theme information. Returns mode (light/dark/system), resolvedTheme (light/dark), and system preference.',
    mimeType: 'application/json',
  };

  async read(): Promise<ReadResourceResult> {
    const store = this.tryGetStore<ThemeStoreState>();

    const themeState = store?.state?.theme ?? {
      mode: 'system' as ThemeMode,
      resolvedTheme: 'light' as ResolvedTheme,
      systemPrefersDark: false,
    };

    return {
      contents: [
        this.createJsonContent('theme://current', {
          mode: themeState.mode,
          resolvedTheme: themeState.resolvedTheme,
          systemPrefersDark: themeState.systemPrefersDark,
          availableModes: ['light', 'dark', 'system'],
        }),
      ],
    };
  }
}

/**
 * Theme Tokens Resource
 *
 * Exposes all design tokens for the current theme at theme://tokens
 *
 * @example AI agent reading theme tokens
 * ```
 * Read resource: theme://tokens
 * Response: { colors: {...}, spacing: {...}, typography: {...}, ... }
 * ```
 */
export class ThemeTokensResource extends BaseThemeResource {
  static readonly metadata = {
    name: 'theme-tokens',
    uri: 'theme://tokens',
    description:
      'All design tokens for the current theme including colors, spacing, typography, radius, shadows, transitions, and z-index values.',
    mimeType: 'application/json',
  };

  async read(): Promise<ReadResourceResult> {
    const store = this.tryGetStore<ThemeStoreState>();

    const themeState = store?.state?.theme;
    const resolvedTheme = themeState?.resolvedTheme ?? 'light';

    // Get base tokens for resolved theme
    const baseTokens = resolvedTheme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;

    // Merge with any custom tokens
    const customTokens = resolvedTheme === 'dark' ? themeState?.customDarkTokens : themeState?.customLightTokens;

    const tokens = customTokens ? this.mergeTokens(baseTokens, customTokens) : baseTokens;

    return {
      contents: [
        this.createJsonContent('theme://tokens', {
          theme: resolvedTheme,
          tokens: {
            colors: tokens.colors,
            spacing: tokens.spacing,
            typography: tokens.typography,
            radius: tokens.radius,
            shadows: tokens.shadows,
            transitions: tokens.transitions,
            zIndex: tokens.zIndex,
          },
        }),
      ],
    };
  }

  /**
   * Merge partial tokens with base tokens
   */
  private mergeTokens(base: DesignTokens, override: Partial<DesignTokens>): DesignTokens {
    return {
      colors: { ...base.colors, ...override.colors } as typeof base.colors,
      spacing: { ...base.spacing, ...override.spacing },
      typography: { ...base.typography, ...override.typography },
      radius: { ...base.radius, ...override.radius },
      shadows: { ...base.shadows, ...override.shadows },
      transitions: { ...base.transitions, ...override.transitions },
      zIndex: { ...base.zIndex, ...override.zIndex },
    };
  }
}

/**
 * Theme Colors Resource
 *
 * Exposes just the color tokens at theme://colors for quick access
 */
export class ThemeColorsResource extends BaseThemeResource {
  static readonly metadata = {
    name: 'theme-colors',
    uri: 'theme://colors',
    description:
      'Color tokens for the current theme including semantic colors, backgrounds, foregrounds, borders, and color palettes.',
    mimeType: 'application/json',
  };

  async read(): Promise<ReadResourceResult> {
    const store = this.tryGetStore<ThemeStoreState>();

    const themeState = store?.state?.theme;
    const resolvedTheme = themeState?.resolvedTheme ?? 'light';

    const baseTokens = resolvedTheme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;

    return {
      contents: [
        this.createJsonContent('theme://colors', {
          theme: resolvedTheme,
          semantic: baseTokens.colors.semantic,
          background: baseTokens.colors.background,
          foreground: baseTokens.colors.foreground,
          border: baseTokens.colors.border,
          palette: baseTokens.colors.palette,
        }),
      ],
    };
  }
}

/**
 * Get all built-in theme resources
 */
export function getThemeResources(): Array<typeof BrowserResourceEntry> {
  return [CurrentThemeResource, ThemeTokensResource, ThemeColorsResource];
}
