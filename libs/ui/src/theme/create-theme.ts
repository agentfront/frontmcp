import { createTheme, type Theme } from '@mui/material/styles';
import type { FrontMcpThemeConfig } from './types';

const SYSTEM_FONT_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

const MONO_FONT_STACK = [
  '"SF Mono"',
  '"Fira Code"',
  '"Fira Mono"',
  'Menlo',
  'Consolas',
  '"DejaVu Sans Mono"',
  'monospace',
].join(',');

export function createFrontMcpTheme(config?: FrontMcpThemeConfig): Theme {
  const mode = config?.mode ?? 'light';
  const palette = config?.palette;
  const typography = config?.typography;
  const shape = config?.shape;

  return createTheme({
    palette: {
      mode,
      primary: { main: palette?.primary ?? '#0969da' },
      secondary: { main: palette?.secondary ?? '#8250df' },
      success: { main: palette?.success ?? '#1a7f37' },
      warning: { main: palette?.warning ?? '#bf8700' },
      error: { main: palette?.error ?? '#cf222e' },
      info: { main: palette?.info ?? '#0550ae' },
      ...(palette?.background
        ? { background: { default: palette.background, paper: palette.surface ?? palette.background } }
        : {}),
      ...(palette?.text ? { text: { primary: palette.text } } : {}),
    },
    typography: {
      fontFamily: typography?.fontFamily ?? SYSTEM_FONT_STACK,
      fontSize: typography?.fontSize ?? 14,
    },
    shape: {
      borderRadius: shape?.borderRadius ?? 8,
    },
    components: {
      MuiButtonBase: {
        defaultProps: {
          disableRipple: false,
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none' as const,
            fontWeight: 500,
          },
        },
      },
    },
  });
}

export const defaultTheme: Theme = createFrontMcpTheme();

export const darkTheme: Theme = createFrontMcpTheme({ mode: 'dark' });

export { SYSTEM_FONT_STACK, MONO_FONT_STACK };
