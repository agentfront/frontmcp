import React from 'react';
import type { ContentRenderer, RenderOptions } from '../types';

export class PdfRenderer implements ContentRenderer {
  readonly type = 'pdf';

  canHandle(content: string): boolean {
    return (
      content.startsWith('%PDF-') ||
      content.trim().startsWith('JVBER') ||
      /^data:application\/pdf[;,]/.test(content.trim())
    );
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    let src: string;
    if (content.startsWith('data:')) {
      src = content;
    } else if (content.startsWith('%PDF-')) {
      const base64 = typeof btoa === 'function' ? btoa(content) : Buffer.from(content).toString('base64');
      src = `data:application/pdf;base64,${base64}`;
    } else {
      src = `data:application/pdf;base64,${content}`;
    }

    return React.createElement('iframe', {
      className: options?.className ?? 'fmcp-pdf-content',
      src,
      style: { width: '100%', height: '600px', border: 'none' },
      title: options?.toolName ?? 'PDF Document',
    });
  }
}

export const pdfRenderer = new PdfRenderer();
