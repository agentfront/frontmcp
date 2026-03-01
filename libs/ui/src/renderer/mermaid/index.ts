import React, { useEffect, useRef, useState, useId } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { useRendererTheme, type RendererThemeValues } from '../common/use-renderer-theme';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Detection
// ============================================

const MERMAID_PATTERN =
  /^\s*(?:graph|sequenceDiagram|classDiagram|stateDiagram|flowchart|erDiagram|gantt|pie|journey|gitGraph)\b/;

export function isMermaid(content: string): boolean {
  return MERMAID_PATTERN.test(content.trim());
}

// ============================================
// Lazy Import
// ============================================

interface MermaidModule {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, definition: string) => Promise<{ svg: string }>;
}

const lazyMermaid = createLazyImport<MermaidModule>('mermaid', async () => {
  const mod = await runtimeImportWithFallback('mermaid', esmShUrl('mermaid@11'));
  const mermaid = (mod['default'] ?? mod) as unknown as MermaidModule;
  return mermaid;
});

// ============================================
// Styled Components
// ============================================

const MermaidRoot = styled(Box, {
  name: 'FrontMcpMermaid',
  slot: 'Root',
})(({ theme }) => ({
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
  padding: theme.spacing(2),
  '& svg': {
    maxWidth: '100%',
    height: 'auto',
  },
}));

// ============================================
// Theme Mapping
// ============================================

function getMermaidTheme(tv: RendererThemeValues): string {
  return tv.mode === 'dark' ? 'dark' : 'default';
}

function getMermaidThemeVariables(tv: RendererThemeValues): Record<string, string> {
  return {
    primaryColor: tv.primary,
    secondaryColor: tv.secondary,
    tertiaryColor: tv.info,
    primaryTextColor: tv.textPrimary,
    secondaryTextColor: tv.textSecondary,
    lineColor: tv.divider,
    fontFamily: tv.fontFamily,
    fontSize: `${tv.fontSize}px`,
  };
}

// ============================================
// Component
// ============================================

interface MermaidViewProps {
  definition: string;
  className?: string;
}

function MermaidView({ definition, className }: MermaidViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const themeValues = useRendererTheme();
  const uniqueId = useId().replace(/:/g, '-');

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram(): Promise<void> {
      try {
        const mermaid = lazyMermaid.get() ?? (await lazyMermaid.load());

        mermaid.initialize({
          startOnLoad: false,
          theme: getMermaidTheme(themeValues),
          themeVariables: getMermaidThemeVariables(themeValues),
          securityLevel: 'strict',
        });

        const result = await mermaid.render(`mermaid-${uniqueId}`, definition);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSvg(null);
        }
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [definition, themeValues, uniqueId]);

  if (error) {
    return React.createElement(
      Box,
      { className },
      React.createElement(Alert, { severity: 'error', sx: { mb: 1 } }, `Mermaid parse error: ${error}`),
      React.createElement(
        'pre',
        { style: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: '0.85em' } },
        definition,
      ),
    );
  }

  if (!svg) {
    return React.createElement(
      MermaidRoot,
      { className },
      React.createElement(Box, { sx: { color: 'text.secondary' } }, 'Rendering diagram...'),
    );
  }

  return React.createElement(MermaidRoot, {
    ref: containerRef,
    className,
    dangerouslySetInnerHTML: { __html: svg },
  });
}

// Eagerly start loading mermaid
lazyMermaid.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class MermaidRenderer implements ContentRenderer {
  readonly type = 'mermaid';
  readonly priority = 50;

  canHandle(content: string): boolean {
    return isMermaid(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(MermaidView, {
      definition: content.trim(),
      className: options?.className ?? 'fmcp-mermaid-content',
    });
  }
}

export const mermaidRenderer = new MermaidRenderer();
