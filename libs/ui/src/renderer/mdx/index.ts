import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import MuiTable from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Lazy Imports
// ============================================

interface ReactMarkdownProps {
  children: string;
  remarkPlugins?: unknown[];
  rehypePlugins?: unknown[];
  components?: Record<string, unknown>;
}

const lazyReactMarkdown = createLazyImport<{ default: React.ComponentType<ReactMarkdownProps> }>(
  'react-markdown',
  async () => {
    const mod = await runtimeImportWithFallback('react-markdown', esmShUrl('react-markdown@9'));
    return mod as unknown as { default: React.ComponentType<ReactMarkdownProps> };
  },
);

const lazyRemarkGfm = createLazyImport<{ default: unknown }>('remark-gfm', async () => {
  const mod = await runtimeImportWithFallback('remark-gfm', esmShUrl('remark-gfm@4'));
  return mod as { default: unknown };
});

const lazyRehypeHighlight = createLazyImport<{ default: unknown }>('rehype-highlight', async () => {
  const mod = await runtimeImportWithFallback('rehype-highlight', esmShUrl('rehype-highlight@7'));
  return mod as { default: unknown };
});

const lazyRehypeRaw = createLazyImport<{ default: unknown }>('rehype-raw', async () => {
  const mod = await runtimeImportWithFallback('rehype-raw', esmShUrl('rehype-raw@7'));
  return mod as { default: unknown };
});

// ============================================
// Styled Components
// ============================================

const MarkdownRoot = styled(Box, {
  name: 'FrontMcpMarkdown',
  slot: 'Root',
})(() => ({
  lineHeight: 1.7,
  '& > *:first-of-type': { marginTop: 0 },
  '& > *:last-child': { marginBottom: 0 },
  '& img': { maxWidth: '100%', height: 'auto' },
}));

const CodeBlock = styled('pre', {
  name: 'FrontMcpMarkdown',
  slot: 'Code',
})(({ theme }) => {
  const monoFont = String(
    (theme.typography as unknown as Record<string, unknown>)['monoFontFamily'] ??
      '"SF Mono", "Fira Code", "Roboto Mono", monospace',
  );
  return {
    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
    padding: theme.spacing(2),
    borderRadius: Number(theme.shape.borderRadius),
    overflow: 'auto',
    fontFamily: monoFont,
    fontSize: '0.875rem',
    '& code': {
      backgroundColor: 'transparent',
      padding: 0,
      fontSize: 'inherit',
      fontFamily: 'inherit',
    },
  };
});

const InlineCode = styled('code')(({ theme }) => {
  const monoFont = String(
    (theme.typography as unknown as Record<string, unknown>)['monoFontFamily'] ??
      '"SF Mono", "Fira Code", "Roboto Mono", monospace',
  );
  return {
    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200],
    padding: '2px 6px',
    borderRadius: Number(theme.shape.borderRadius) / 2,
    fontFamily: monoFont,
    fontSize: '0.85em',
  };
});

const Blockquote = styled('blockquote', {
  name: 'FrontMcpMarkdown',
  slot: 'Blockquote',
})(({ theme }) => ({
  borderLeft: `4px solid ${theme.palette.primary.main}`,
  margin: theme.spacing(2, 0),
  padding: theme.spacing(1, 2),
  color: theme.palette.text.secondary,
  '& > p': { margin: 0 },
}));

// ============================================
// MUI Component Overrides for react-markdown
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
function createMuiComponents(): Record<string, unknown> {
  return {
    h1: (props: any) => React.createElement(Typography, { ...props, variant: 'h4', gutterBottom: true }),
    h2: (props: any) => React.createElement(Typography, { ...props, variant: 'h5', gutterBottom: true }),
    h3: (props: any) => React.createElement(Typography, { ...props, variant: 'h6', gutterBottom: true }),
    h4: (props: any) =>
      React.createElement(Typography, { ...props, variant: 'subtitle1', gutterBottom: true, fontWeight: 600 }),
    h5: (props: any) => React.createElement(Typography, { ...props, variant: 'subtitle2', gutterBottom: true }),
    h6: (props: any) => React.createElement(Typography, { ...props, variant: 'subtitle2', gutterBottom: true }),
    p: (props: any) => React.createElement(Typography, { ...props, variant: 'body1', paragraph: true }),
    a: (props: any) => React.createElement(Link, { ...props, target: '_blank', rel: 'noopener noreferrer' }),
    blockquote: (props: any) => React.createElement(Blockquote, props),
    pre: (props: any) => React.createElement(CodeBlock, props),
    code: ({ inline, className, children, ...rest }: any) => {
      if (inline) return React.createElement(InlineCode, rest, children);
      return React.createElement('code', { className, ...rest }, children);
    },
    table: (props: any) => React.createElement(MuiTable, { ...props, size: 'small' }),
    thead: (props: any) => React.createElement(TableHead, props),
    tbody: (props: any) => React.createElement(TableBody, props),
    tr: (props: any) => React.createElement(TableRow, { ...props, hover: true }),
    th: (props: any) => React.createElement(TableCell, { ...props, sx: { fontWeight: 600 } }),
    td: (props: any) => React.createElement(TableCell, props),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ============================================
// Component
// ============================================

interface MarkdownViewProps {
  content: string;
  className?: string;
}

function MarkdownView({ content, className }: MarkdownViewProps): React.ReactElement {
  const components = useMemo(() => createMuiComponents(), []);

  const ReactMarkdownMod = useLazyModule(lazyReactMarkdown);
  const remarkGfmMod = lazyRemarkGfm.get();
  const rehypeHighlightMod = lazyRehypeHighlight.get();
  const rehypeRawMod = lazyRehypeRaw.get();

  // If react-markdown is loaded, use it
  if (ReactMarkdownMod) {
    const ReactMarkdown = ReactMarkdownMod.default;
    const remarkPlugins: unknown[] = [];
    const rehypePlugins: unknown[] = [];

    if (remarkGfmMod) remarkPlugins.push(remarkGfmMod.default);
    if (rehypeHighlightMod) rehypePlugins.push(rehypeHighlightMod.default);
    if (rehypeRawMod) rehypePlugins.push(rehypeRawMod.default);

    return React.createElement(
      MarkdownRoot,
      { className },
      React.createElement(ReactMarkdown, {
        children: content,
        remarkPlugins,
        rehypePlugins,
        components,
      }),
    );
  }

  // Fallback: basic line-by-line parser
  return React.createElement(MarkdownRoot, { className }, ...renderFallback(content));
}

function renderFallback(content: string): React.ReactElement[] {
  const lines = content.split('\n');
  const elements: React.ReactElement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# ')) {
      elements.push(React.createElement(Typography, { key: i, variant: 'h4', gutterBottom: true }, line.slice(2)));
    } else if (line.startsWith('## ')) {
      elements.push(React.createElement(Typography, { key: i, variant: 'h5', gutterBottom: true }, line.slice(3)));
    } else if (line.startsWith('### ')) {
      elements.push(React.createElement(Typography, { key: i, variant: 'h6', gutterBottom: true }, line.slice(4)));
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(React.createElement('li', { key: i }, line.slice(2)));
    } else if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(React.createElement(Typography, { key: i, variant: 'body1', fontWeight: 700 }, line.slice(2, -2)));
    } else if (line.trim()) {
      elements.push(React.createElement(Typography, { key: i, variant: 'body1', paragraph: true }, line));
    }
  }

  return elements;
}

// Eagerly start loading react-markdown and plugins
lazyReactMarkdown.load().catch(() => {
  /* optional dep */
});
lazyRemarkGfm.load().catch(() => {
  /* optional dep */
});
lazyRehypeHighlight.load().catch(() => {
  /* optional dep */
});
lazyRehypeRaw.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class MdxRenderer implements ContentRenderer {
  readonly type = 'mdx';
  readonly priority = 5;

  canHandle(content: string): boolean {
    return (
      /^---\s*\n/.test(content) ||
      /import\s+/.test(content) ||
      /<[A-Z]/.test(content) ||
      /^#{1,6}\s+\S/m.test(content) ||
      /^\s*[-*+]\s+\S/m.test(content)
    );
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(MarkdownView, {
      content,
      className: options?.className ?? 'fmcp-mdx-content',
    });
  }
}

export const mdxRenderer = new MdxRenderer();
