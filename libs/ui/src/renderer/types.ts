import type { ReactElement } from 'react';
import type { Theme } from '@mui/material/styles';

/**
 * All content types supported by the renderer system.
 */
export type ContentType =
  | 'jsx'
  | 'mdx'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'csv'
  | 'chart'
  | 'mermaid'
  | 'flow'
  | 'math'
  | 'map'
  | 'image'
  | 'video'
  | 'audio';

export interface RenderOptions {
  input?: Record<string, unknown>;
  output?: unknown;
  toolName?: string;
  className?: string;
  /** Per-renderer configuration options. */
  rendererOptions?: Record<string, unknown>;
  /** MUI theme instance for renderers that need it. */
  theme?: Theme;
}

export interface ContentRenderer {
  readonly type: string;
  /** Higher priority renderers are checked first (default: 0). */
  readonly priority?: number;
  canHandle(content: string): boolean;
  render(content: string, options?: RenderOptions): ReactElement;
}
