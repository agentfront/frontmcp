import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import { runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Styled Components
// ============================================

const HtmlRoot = styled(Box, {
  name: 'FrontMcpHtml',
  slot: 'Root',
})(({ theme }) => ({
  '& a': { color: theme.palette.primary.main },
  '& table': { borderCollapse: 'collapse', width: '100%' },
  '& th, & td': { border: `1px solid ${theme.palette.divider}`, padding: theme.spacing(1) },
  '& pre': {
    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.borderRadius,
    overflow: 'auto',
  },
}));

// ============================================
// DOMPurify lazy loader
// ============================================

type DOMPurifyModule = { default?: { sanitize: (html: string) => string }; sanitize?: (html: string) => string };
let purifyModule: DOMPurifyModule | null = null;
let purifyPromise: Promise<DOMPurifyModule> | null = null;

function loadDOMPurify(): Promise<DOMPurifyModule> {
  if (purifyModule) return Promise.resolve(purifyModule);
  if (purifyPromise) return purifyPromise;

  purifyPromise = (runtimeImportWithFallback('dompurify', esmShUrl('dompurify@3')) as Promise<DOMPurifyModule>)
    .then((mod) => {
      purifyModule = mod;
      return purifyModule;
    })
    .catch(() => {
      // DOMPurify not available — return null, will render unsanitized
      purifyModule = null;
      purifyPromise = null;
      return null as unknown as DOMPurifyModule;
    });

  return purifyPromise;
}

function sanitizeSync(html: string): string {
  if (!purifyModule) return html;
  const sanitize = purifyModule.default?.sanitize ?? purifyModule.sanitize;
  return sanitize ? sanitize(html) : html;
}

// Eagerly attempt to load DOMPurify so it's available for synchronous render
loadDOMPurify();

// ============================================
// Component
// ============================================

interface HtmlViewProps {
  html: string;
  className?: string;
}

function HtmlView({ html, className }: HtmlViewProps): React.ReactElement {
  const sanitized = useMemo(() => sanitizeSync(html), [html]);

  return React.createElement(HtmlRoot, {
    className,
    dangerouslySetInnerHTML: { __html: sanitized },
  });
}

// ============================================
// Renderer
// ============================================

export class HtmlRenderer implements ContentRenderer {
  readonly type = 'html';
  readonly priority = 0;

  canHandle(content: string): boolean {
    return /^\s*</.test(content) && /<\/\w+>/.test(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(HtmlView, {
      html: content,
      className: options?.className ?? 'fmcp-html-content',
    });
  }
}

export const htmlRenderer = new HtmlRenderer();
