import type { ReactElement } from 'react';

export interface RenderOptions {
  input?: Record<string, unknown>;
  output?: unknown;
  toolName?: string;
  className?: string;
}

export interface ContentRenderer {
  readonly type: string;
  canHandle(content: string): boolean;
  render(content: string, options?: RenderOptions): ReactElement;
}
