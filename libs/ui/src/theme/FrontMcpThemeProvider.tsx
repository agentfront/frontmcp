import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import React from 'react';

import { createFrontMcpTheme, defaultTheme } from './create-theme';
import type { FrontMcpThemeProviderProps } from './types';

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
