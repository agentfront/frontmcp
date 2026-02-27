import React from 'react';
import type { ContentRenderer, RenderOptions } from '../types';

export class HtmlRenderer implements ContentRenderer {
  readonly type = 'html';

  canHandle(content: string): boolean {
    return /^\s*</.test(content) && /<\/\w+>/.test(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement('div', {
      className: options?.className ?? 'fmcp-html-content',
      dangerouslySetInnerHTML: { __html: content },
    });
  }
}

export const htmlRenderer = new HtmlRenderer();
