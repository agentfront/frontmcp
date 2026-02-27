import React from 'react';
import type { ContentRenderer, RenderOptions } from '../types';

export class MdxRenderer implements ContentRenderer {
  readonly type = 'mdx';

  canHandle(content: string): boolean {
    return /^---\s*\n/.test(content) || /import\s+/.test(content) || /<[A-Z]/.test(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    const lines = content.split('\n');
    const elements: React.ReactElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('# ')) {
        elements.push(React.createElement('h1', { key: i }, line.slice(2)));
      } else if (line.startsWith('## ')) {
        elements.push(React.createElement('h2', { key: i }, line.slice(3)));
      } else if (line.startsWith('### ')) {
        elements.push(React.createElement('h3', { key: i }, line.slice(4)));
      } else if (line.startsWith('- ')) {
        elements.push(React.createElement('li', { key: i }, line.slice(2)));
      } else if (line.startsWith('**') && line.endsWith('**')) {
        elements.push(React.createElement('strong', { key: i }, line.slice(2, -2)));
      } else if (line.trim()) {
        elements.push(React.createElement('p', { key: i }, line));
      }
    }

    return React.createElement('div', { className: options?.className ?? 'fmcp-mdx-content' }, ...elements);
  }
}

export const mdxRenderer = new MdxRenderer();
