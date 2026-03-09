import type { ReactNode } from 'react';

export interface FrontMcpThemeConfig {
  palette?: {
    primary?: string;
    secondary?: string;
    success?: string;
    warning?: string;
    error?: string;
    info?: string;
    background?: string;
    surface?: string;
    text?: string;
  };
  typography?: {
    fontFamily?: string;
    monoFontFamily?: string;
    fontSize?: number;
  };
  shape?: {
    borderRadius?: number;
  };
  mode?: 'light' | 'dark';
}

export interface FrontMcpThemeProviderProps {
  theme?: FrontMcpThemeConfig;
  children: ReactNode;
}
