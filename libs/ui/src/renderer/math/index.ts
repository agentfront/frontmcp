import React, { useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { injectStylesheet } from '../common/inject-stylesheet';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Constants
// ============================================

const KATEX_CSS_URL = 'https://esm.sh/katex@0.16.11/dist/katex.min.css';
const KATEX_CSS_ID = 'fmcp-katex-css';

// ============================================
// Detection
// ============================================

const MATH_DISPLAY = /\$\$.+?\$\$/s;
const MATH_INLINE = /\$[^$\n]+?\$/;
const MATH_BRACKET_DISPLAY = /\\\[[\s\S]+?\\\]/;
const MATH_PAREN_INLINE = /\\\([\s\S]+?\\\)/;
const MATH_BEGIN = /\\begin\{(?:equation|align|gather|matrix|pmatrix|bmatrix|cases)\}/;

export function isMath(content: string): boolean {
  const trimmed = content.trim();
  return (
    MATH_DISPLAY.test(trimmed) ||
    MATH_INLINE.test(trimmed) ||
    MATH_BRACKET_DISPLAY.test(trimmed) ||
    MATH_PAREN_INLINE.test(trimmed) ||
    MATH_BEGIN.test(trimmed)
  );
}

// ============================================
// Lazy Imports
// ============================================

interface KaTeXModule {
  default?: { renderToString: (tex: string, opts?: Record<string, unknown>) => string };
  renderToString?: (tex: string, opts?: Record<string, unknown>) => string;
}

const lazyKatex = createLazyImport<KaTeXModule>('katex', async () => {
  const mod = await runtimeImportWithFallback('katex', esmShUrl('katex@0.16'));
  return mod as unknown as KaTeXModule;
});

// ============================================
// Styled Components
// ============================================

const MathRoot = styled(Box, {
  name: 'FrontMcpMath',
  slot: 'Root',
})(({ theme }) => ({
  color: theme.palette.text.primary,
  '& .katex-display': {
    margin: theme.spacing(2, 0),
    textAlign: 'center',
  },
}));

const MathDisplay = styled(Box, {
  name: 'FrontMcpMath',
  slot: 'Display',
})(({ theme }) => ({
  display: 'block',
  textAlign: 'center',
  margin: theme.spacing(2, 0),
  fontSize: '1.2em',
  overflow: 'auto',
}));

const MathInline = styled('span', {
  name: 'FrontMcpMath',
  slot: 'Inline',
})({
  display: 'inline',
});

// ============================================
// Parsing
// ============================================

interface MathSegment {
  type: 'text' | 'display' | 'inline';
  content: string;
}

function parseMathContent(source: string): MathSegment[] {
  const segments: MathSegment[] = [];
  // Combined regex for all math delimiters
  const mathRegex =
    /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\begin\{[\s\S]+?\\end\{[^}]+\})/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(source)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: source.slice(lastIndex, match.index) });
    }

    const raw = match[0];
    if (raw.startsWith('$$')) {
      segments.push({ type: 'display', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('\\[')) {
      segments.push({ type: 'display', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('\\begin')) {
      segments.push({ type: 'display', content: raw });
    } else if (raw.startsWith('\\(')) {
      segments.push({ type: 'inline', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('$')) {
      segments.push({ type: 'inline', content: raw.slice(1, -1).trim() });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < source.length) {
    segments.push({ type: 'text', content: source.slice(lastIndex) });
  }

  return segments;
}

// ============================================
// Component
// ============================================

interface MathViewProps {
  content: string;
  className?: string;
}

function MathView({ content, className }: MathViewProps): React.ReactElement {
  useEffect(() => {
    injectStylesheet(KATEX_CSS_URL, KATEX_CSS_ID);
  }, []);

  const katexMod = useLazyModule(lazyKatex);
  const segments = useMemo(() => parseMathContent(content), [content]);

  const renderToString = katexMod?.default?.renderToString ?? katexMod?.renderToString;

  if (!renderToString) {
    // KaTeX not loaded — show raw source in styled container
    return React.createElement(
      MathRoot,
      { className },
      React.createElement('pre', { style: { fontFamily: 'monospace', whiteSpace: 'pre-wrap' } }, content),
    );
  }

  const elements = segments.map((seg, i) => {
    if (seg.type === 'text') {
      return React.createElement('span', { key: i }, seg.content);
    }

    try {
      const html = renderToString(seg.content, {
        displayMode: seg.type === 'display',
        throwOnError: false,
      });

      if (seg.type === 'display') {
        return React.createElement(MathDisplay, {
          key: i,
          dangerouslySetInnerHTML: { __html: html },
        });
      }
      return React.createElement(MathInline, {
        key: i,
        dangerouslySetInnerHTML: { __html: html },
      });
    } catch (err) {
      return React.createElement(
        Alert,
        { key: i, severity: 'error', sx: { my: 1 } },
        `LaTeX error: ${err instanceof Error ? err.message : String(err)}\nSource: ${seg.content}`,
      );
    }
  });

  return React.createElement(MathRoot, { className }, ...elements);
}

// Eagerly start loading KaTeX
lazyKatex.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class MathRenderer implements ContentRenderer {
  readonly type = 'math';
  readonly priority = 40;

  canHandle(content: string): boolean {
    return isMath(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(MathView, {
      content,
      className: options?.className ?? 'fmcp-math-content',
    });
  }
}

export const mathRenderer = new MathRenderer();
