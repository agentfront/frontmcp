import React from 'react';
import type { ContentRenderer, RenderOptions } from '../types';

export class ReactJsxRenderer implements ContentRenderer {
  readonly type = 'jsx';

  canHandle(content: string): boolean {
    return /(?:function|const|class)\s+\w+/.test(content) && /(?:return|=>)\s*[\s(]*</.test(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(
      'div',
      { className: options?.className ?? 'fmcp-jsx-content' },
      React.createElement('pre', null, React.createElement('code', null, content)),
    );
  }
}

export const reactJsxRenderer = new ReactJsxRenderer();
