import React, { useState, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl, ESM_SH_BASE } from '../common/lazy-import';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Lazy Import
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ReactPdfModule {
  Document: React.ComponentType<any>;
  Page: React.ComponentType<any>;
  pdfjs?: { version?: string; GlobalWorkerOptions: { workerSrc: string } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const lazyReactPdf = createLazyImport<ReactPdfModule>('react-pdf', async () => {
  const mod = await runtimeImportWithFallback(
    'react-pdf',
    esmShUrl('react-pdf@9', { external: ['react', 'react-dom'] }),
  );

  // Configure PDF.js worker — the default bare specifier 'pdf.worker.mjs'
  // can't be resolved in browser environments. Use the CDN worker instead.
  const pdfjs = (mod as Record<string, unknown>)['pdfjs'] as ReactPdfModule['pdfjs'];
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = `${ESM_SH_BASE}pdfjs-dist@${pdfjs.version ?? '4'}/build/pdf.worker.min.mjs?raw`;
  }

  return mod as unknown as ReactPdfModule;
});

// ============================================
// Helpers
// ============================================

function toDataUri(content: string): string {
  if (content.startsWith('data:')) return content;
  if (content.startsWith('%PDF-')) {
    const base64 = typeof btoa === 'function' ? btoa(content) : Buffer.from(content).toString('base64');
    return `data:application/pdf;base64,${base64}`;
  }
  return `data:application/pdf;base64,${content}`;
}

// ============================================
// Styled Components
// ============================================

const PdfRoot = styled(Box, {
  name: 'FrontMcpPdf',
  slot: 'Root',
})(({ theme }) => ({
  width: '100%',
  borderRadius: theme.shape.borderRadius,
  overflow: 'hidden',
  border: `1px solid ${theme.palette.divider}`,
}));

const Toolbar = styled(Box, {
  name: 'FrontMcpPdf',
  slot: 'Toolbar',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(1, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50],
}));

const PageContainer = styled(Box, {
  name: 'FrontMcpPdf',
  slot: 'PageContainer',
})({
  display: 'flex',
  justifyContent: 'center',
  overflow: 'auto',
  maxHeight: 700,
});

// ============================================
// Component
// ============================================

interface PdfViewProps {
  content: string;
  className?: string;
  title?: string;
}

function PdfView({ content, className, title }: PdfViewProps): React.ReactElement {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

  const reactPdf = useLazyModule(lazyReactPdf);
  const dataUri = useMemo(() => toDataUri(content), [content]);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  const goToPrev = useCallback(() => setPageNumber((p) => Math.max(1, p - 1)), []);
  const goToNext = useCallback(() => setPageNumber((p) => Math.min(numPages, p + 1)), []);
  const zoomIn = useCallback(() => setScale((s) => Math.min(3, s + 0.25)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(0.25, s - 0.25)), []);

  // Fallback: iframe if react-pdf not available
  if (!reactPdf) {
    return React.createElement('iframe', {
      className: className ?? 'fmcp-pdf-content',
      src: dataUri,
      style: { width: '100%', height: '600px', border: 'none' },
      title: title ?? 'PDF Document',
    });
  }

  const { Document, Page } = reactPdf;

  return React.createElement(
    PdfRoot,
    { className },
    React.createElement(
      Toolbar,
      null,
      React.createElement(
        IconButton,
        { size: 'small', onClick: goToPrev, disabled: pageNumber <= 1, 'aria-label': 'Previous page' },
        '\u25C0',
      ),
      React.createElement(
        Typography,
        { variant: 'body2', sx: { minWidth: 80, textAlign: 'center' } },
        `${pageNumber} / ${numPages || '...'}`,
      ),
      React.createElement(
        IconButton,
        { size: 'small', onClick: goToNext, disabled: pageNumber >= numPages, 'aria-label': 'Next page' },
        '\u25B6',
      ),
      React.createElement(Box, { sx: { flex: 1 } }),
      React.createElement(IconButton, { size: 'small', onClick: zoomOut, 'aria-label': 'Zoom out' }, '\u2212'),
      React.createElement(
        Typography,
        { variant: 'body2', sx: { minWidth: 50, textAlign: 'center' } },
        `${Math.round(scale * 100)}%`,
      ),
      React.createElement(IconButton, { size: 'small', onClick: zoomIn, 'aria-label': 'Zoom in' }, '+'),
      React.createElement(Box, { sx: { flex: 1 } }),
      React.createElement(TextField, {
        size: 'small',
        type: 'number',
        value: pageNumber,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          const n = parseInt(e.target.value, 10);
          if (n >= 1 && n <= numPages) setPageNumber(n);
        },
        sx: { width: 70 },
        slotProps: { htmlInput: { min: 1, max: numPages, 'aria-label': 'Go to page' } },
      }),
    ),
    React.createElement(
      PageContainer,
      null,
      React.createElement(
        Document,
        { file: dataUri, onLoadSuccess: onDocumentLoadSuccess },
        React.createElement(Page, { pageNumber, scale, renderTextLayer: false, renderAnnotationLayer: false }),
      ),
    ),
  );
}

// Eagerly start loading react-pdf
lazyReactPdf.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class PdfRenderer implements ContentRenderer {
  readonly type = 'pdf';
  readonly priority = 90;

  canHandle(content: string): boolean {
    return (
      content.startsWith('%PDF-') ||
      content.trim().startsWith('JVBER') ||
      /^data:application\/pdf[;,]/.test(content.trim())
    );
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(PdfView, {
      content,
      className: options?.className ?? 'fmcp-pdf-content',
      title: options?.toolName ?? 'PDF Document',
    });
  }
}

export const pdfRenderer = new PdfRenderer();
