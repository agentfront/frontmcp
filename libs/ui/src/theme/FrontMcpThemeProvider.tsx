import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import type { FrontMcpThemeProviderProps } from './types';
import { createFrontMcpTheme, defaultTheme } from './create-theme';

export function FrontMcpThemeProvider({
  theme: themeConfig,
  children,
}: FrontMcpThemeProviderProps): React.ReactElement {
  const muiTheme = themeConfig ? createFrontMcpTheme(themeConfig) : defaultTheme;

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
