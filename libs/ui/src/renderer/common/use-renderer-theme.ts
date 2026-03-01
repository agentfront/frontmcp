import { useMemo } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

/**
 * Flat theme values extracted from MUI theme for non-MUI libraries.
 * Used by Recharts, Mermaid, Leaflet, KaTeX, ReactFlow, etc.
 */
export interface RendererThemeValues {
  mode: 'light' | 'dark';
  primary: string;
  secondary: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  background: string;
  paper: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  fontFamily: string;
  monoFontFamily: string;
  fontSize: number;
  borderRadius: number;
  /** Ordered palette colors for data series */
  seriesColors: string[];
}

/**
 * Extract flat theme values from MUI theme for use in non-MUI renderers.
 */
export function extractThemeValues(theme: Theme): RendererThemeValues {
  const palette = theme.palette;
  return {
    mode: palette.mode,
    primary: palette.primary.main,
    secondary: palette.secondary.main,
    error: palette.error.main,
    warning: palette.warning.main,
    success: palette.success.main,
    info: palette.info.main,
    background: palette.background.default,
    paper: palette.background.paper,
    textPrimary: palette.text.primary,
    textSecondary: palette.text.secondary,
    divider: palette.divider,
    fontFamily: theme.typography.fontFamily ?? 'sans-serif',
    monoFontFamily:
      ((theme.typography as unknown as Record<string, unknown>)['monoFontFamily'] as string) ??
      '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',
    fontSize: (theme.typography.fontSize as number) ?? 14,
    borderRadius: typeof theme.shape.borderRadius === 'number' ? theme.shape.borderRadius : 4,
    seriesColors: [
      palette.primary.main,
      palette.secondary.main,
      palette.error.main,
      palette.warning.main,
      palette.success.main,
      palette.info.main,
    ],
  };
}

/**
 * React hook that extracts MUI theme values into a flat object
 * for use by non-MUI rendering libraries (Recharts, Mermaid, etc.).
 */
export function useRendererTheme(): RendererThemeValues {
  const theme = useTheme();
  return useMemo(() => extractThemeValues(theme), [theme]);
}
