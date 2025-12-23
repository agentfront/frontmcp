// file: libs/browser/src/theme/theme-provider.tsx
/**
 * Theme Provider
 *
 * React context provider for theming with design tokens,
 * dark/light mode support, and CSS custom properties.
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { LIGHT_TOKENS, DARK_TOKENS, type DesignTokens, type ColorScheme } from './tokens';

/**
 * Theme mode
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Resolved theme (never 'system')
 */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Theme context value
 */
export interface ThemeContextValue {
  /** Current theme mode setting */
  mode: ThemeMode;
  /** Resolved theme (accounts for system preference) */
  resolvedTheme: ResolvedTheme;
  /** Set the theme mode */
  setMode: (mode: ThemeMode) => void;
  /** Toggle between light and dark */
  toggle: () => void;
  /** Current design tokens */
  tokens: DesignTokens;
  /** Get a CSS variable value */
  getVar: (path: string) => string;
  /** Is system dark mode preferred */
  systemPrefersDark: boolean;
}

/**
 * Theme provider props
 */
export interface ThemeProviderProps {
  /** Children to render */
  children: ReactNode;
  /** Initial theme mode */
  defaultMode?: ThemeMode;
  /** Storage key for persistence */
  storageKey?: string;
  /** Custom light theme tokens */
  lightTokens?: Partial<DesignTokens>;
  /** Custom dark theme tokens */
  darkTokens?: Partial<DesignTokens>;
  /** Apply theme to root element */
  applyToRoot?: boolean;
  /** CSS variable prefix */
  cssPrefix?: string;
  /** Force a specific theme (ignores mode) */
  forcedTheme?: ResolvedTheme;
  /** Disable transitions during theme change */
  disableTransitionOnChange?: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Merge partial tokens with defaults
 */
function mergeTokens(base: DesignTokens, override: Partial<DesignTokens>): DesignTokens {
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

/**
 * Generate CSS custom properties from tokens
 */
function generateCssVariables(tokens: DesignTokens, prefix: string): Record<string, string> {
  const vars: Record<string, string> = {};

  // Colors
  const addColors = (obj: object, path: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const varName = `--${prefix}-${path}-${key}`;
      if (typeof value === 'string') {
        vars[varName] = value;
      } else if (typeof value === 'object' && value !== null) {
        addColors(value, `${path}-${key}`);
      }
    }
  };

  addColors(tokens.colors.semantic, 'color');
  addColors(tokens.colors.background, 'bg');
  addColors(tokens.colors.foreground, 'fg');
  addColors(tokens.colors.border, 'border');

  // Spacing
  for (const [key, value] of Object.entries(tokens.spacing)) {
    vars[`--${prefix}-space-${key}`] = value;
  }

  // Typography
  vars[`--${prefix}-font-sans`] = tokens.typography.fontFamily.sans;
  vars[`--${prefix}-font-mono`] = tokens.typography.fontFamily.mono;
  for (const [key, value] of Object.entries(tokens.typography.fontSize)) {
    vars[`--${prefix}-text-${key}`] = value;
  }
  for (const [key, value] of Object.entries(tokens.typography.fontWeight)) {
    vars[`--${prefix}-font-${key}`] = String(value);
  }
  for (const [key, value] of Object.entries(tokens.typography.lineHeight)) {
    vars[`--${prefix}-leading-${key}`] = String(value);
  }
  for (const [key, value] of Object.entries(tokens.typography.letterSpacing)) {
    vars[`--${prefix}-tracking-${key}`] = value;
  }

  // Radius
  for (const [key, value] of Object.entries(tokens.radius)) {
    vars[`--${prefix}-radius-${key}`] = value;
  }

  // Shadows
  for (const [key, value] of Object.entries(tokens.shadows)) {
    vars[`--${prefix}-shadow-${key}`] = value;
  }

  // Transitions
  for (const [key, value] of Object.entries(tokens.transitions.duration)) {
    vars[`--${prefix}-duration-${key}`] = value;
  }
  for (const [key, value] of Object.entries(tokens.transitions.timing)) {
    vars[`--${prefix}-ease-${key}`] = value;
  }

  // Z-index
  for (const [key, value] of Object.entries(tokens.zIndex)) {
    vars[`--${prefix}-z-${key}`] = String(value);
  }

  return vars;
}

/**
 * Apply CSS variables to an element
 */
function applyCssVariables(element: HTMLElement, vars: Record<string, string>): void {
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value);
  }
}

/**
 * Get system color scheme preference
 */
function getSystemPreference(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * ThemeProvider - Provides theming context to the application
 *
 * @example Basic usage
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * @example With custom default and persistence
 * ```tsx
 * <ThemeProvider defaultMode="dark" storageKey="my-app-theme">
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * @example With custom tokens
 * ```tsx
 * <ThemeProvider
 *   lightTokens={{
 *     colors: {
 *       semantic: { primary: '#0066cc' }
 *     }
 *   }}
 * >
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  children,
  defaultMode = 'system',
  storageKey = 'frontmcp-theme',
  lightTokens = {},
  darkTokens = {},
  applyToRoot = true,
  cssPrefix = 'fmcp',
  forcedTheme,
  disableTransitionOnChange = true,
}: ThemeProviderProps): React.ReactElement {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return defaultMode;
    }
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // Ignore storage errors
    }
    return defaultMode;
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPreference() === 'dark');

  // Listen for system preference changes
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Resolve theme
  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    if (forcedTheme) {
      return forcedTheme;
    }
    if (mode === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    return mode;
  }, [mode, systemPrefersDark, forcedTheme]);

  // Get tokens for resolved theme
  const tokens = useMemo(() => {
    const baseTokens = resolvedTheme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;
    const overrideTokens = resolvedTheme === 'dark' ? darkTokens : lightTokens;
    return mergeTokens(baseTokens, overrideTokens);
  }, [resolvedTheme, lightTokens, darkTokens]);

  // Apply CSS variables to root
  useEffect(() => {
    if (!applyToRoot || typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;

    // Disable transitions during theme change
    if (disableTransitionOnChange) {
      root.style.setProperty('transition', 'none');
      requestAnimationFrame(() => {
        root.style.removeProperty('transition');
      });
    }

    const cssVars = generateCssVariables(tokens, cssPrefix);
    applyCssVariables(root, cssVars);

    // Set data attribute for CSS selectors
    root.setAttribute('data-theme', resolvedTheme);
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [tokens, resolvedTheme, applyToRoot, cssPrefix, disableTransitionOnChange]);

  // Set mode with persistence
  const setMode = useCallback(
    (newMode: ThemeMode) => {
      setModeState(newMode);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey, newMode);
        } catch {
          // Ignore storage errors
        }
      }
    },
    [storageKey],
  );

  // Toggle theme
  const toggle = useCallback(() => {
    setMode(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setMode]);

  // Get CSS variable value
  const getVar = useCallback(
    (path: string): string => {
      return `var(--${cssPrefix}-${path})`;
    },
    [cssPrefix],
  );

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode,
      toggle,
      tokens,
      getVar,
      systemPrefersDark,
    }),
    [mode, resolvedTheme, setMode, toggle, tokens, getVar, systemPrefersDark],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

/**
 * Hook to access theme context
 *
 * @throws Error if used outside of ThemeProvider
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { resolvedTheme, toggle } = useTheme();
 *
 *   return (
 *     <button onClick={toggle}>
 *       Current: {resolvedTheme}
 *     </button>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Hook to get a specific token value
 *
 * @example
 * ```tsx
 * function Card() {
 *   const bgColor = useToken('colors.background.subtle');
 *   const borderRadius = useToken('radius.md');
 *
 *   return (
 *     <div style={{ backgroundColor: bgColor, borderRadius }}>
 *       Content
 *     </div>
 *   );
 * }
 * ```
 */
export function useToken<T = string>(path: string): T {
  const { tokens } = useTheme();

  return useMemo(() => {
    const parts = path.split('.');
    let value: unknown = tokens;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        console.warn(`Token not found: ${path}`);
        return '' as T;
      }
    }

    return value as T;
  }, [tokens, path]);
}
