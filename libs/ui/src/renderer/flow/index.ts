import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { useRendererTheme } from '../common/use-renderer-theme';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Types
// ============================================

export interface FlowNode {
  id: string;
  data: { label: string; [key: string]: unknown };
  position: { x: number; y: number };
  type?: string;
  style?: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  type?: string;
  style?: Record<string, unknown>;
}

export interface FlowConfig {
  nodes: FlowNode[];
  edges: FlowEdge[];
  fitView?: boolean;
  title?: string;
  height?: number;
}

// ============================================
// Detection
// ============================================

const FLOW_PATTERN = /^\s*\{[\s\S]*"nodes"\s*:\s*\[[\s\S]*"edges"\s*:\s*\[/;

export function isFlow(content: string): boolean {
  return FLOW_PATTERN.test(content.trim());
}

// ============================================
// Lazy Import
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
interface XYFlowModule {
  ReactFlow: React.ComponentType<any>;
  Controls: React.ComponentType<any>;
  MiniMap: React.ComponentType<any>;
  Background: React.ComponentType<any>;
  BackgroundVariant?: Record<string, unknown>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const lazyXYFlow = createLazyImport<XYFlowModule>('@xyflow/react', async () => {
  const mod = await runtimeImportWithFallback('@xyflow/react', esmShUrl('@xyflow/react@12'));
  return mod as unknown as XYFlowModule;
});

// ============================================
// Styled Components
// ============================================

const FlowRoot = styled(Box, {
  name: 'FrontMcpFlow',
  slot: 'Root',
})(({ theme }) => ({
  width: '100%',
  borderRadius: theme.shape.borderRadius,
  overflow: 'hidden',
  border: `1px solid ${theme.palette.divider}`,
}));

// ============================================
// Component
// ============================================

interface FlowViewProps {
  config: FlowConfig;
  className?: string;
}

function FlowView({ config, className }: FlowViewProps): React.ReactElement {
  const themeValues = useRendererTheme();
  const xyflow = useLazyModule(lazyXYFlow);
  const height = config.height ?? 500;

  const styledNodes = useMemo(() => {
    return config.nodes.map((node) => ({
      ...node,
      style: {
        background: themeValues.paper,
        color: themeValues.textPrimary,
        border: `1px solid ${themeValues.divider}`,
        borderRadius: themeValues.borderRadius,
        padding: 8,
        fontSize: themeValues.fontSize,
        fontFamily: themeValues.fontFamily,
        ...node.style,
      },
    }));
  }, [config.nodes, themeValues]);

  const styledEdges = useMemo(() => {
    return config.edges.map((edge, i) => ({
      ...edge,
      style: {
        stroke: themeValues.seriesColors[i % themeValues.seriesColors.length],
        strokeWidth: 2,
        ...edge.style,
      },
    }));
  }, [config.edges, themeValues]);

  if (!xyflow) {
    return React.createElement(Alert, { severity: 'info' }, 'Loading flow diagram library...');
  }

  const { ReactFlow, Controls, MiniMap, Background } = xyflow;

  return React.createElement(
    FlowRoot,
    { className },
    config.title &&
      React.createElement(
        Typography,
        { variant: 'subtitle1', fontWeight: 600, sx: { p: 1.5, borderBottom: 1, borderColor: 'divider' } },
        config.title,
      ),
    React.createElement(
      Box,
      { sx: { height } },
      React.createElement(
        ReactFlow,
        {
          nodes: styledNodes,
          edges: styledEdges,
          fitView: config.fitView !== false,
          proOptions: { hideAttribution: true },
        },
        React.createElement(Controls, {
          style: {
            backgroundColor: themeValues.paper,
            borderRadius: themeValues.borderRadius,
            border: `1px solid ${themeValues.divider}`,
          },
        }),
        React.createElement(MiniMap, {
          style: {
            backgroundColor: themeValues.background,
            borderRadius: themeValues.borderRadius,
          },
          nodeColor: themeValues.primary,
        }),
        Background &&
          React.createElement(Background, {
            color: themeValues.divider,
            gap: 16,
          }),
      ),
    ),
  );
}

// Eagerly start loading @xyflow/react
lazyXYFlow.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class FlowRenderer implements ContentRenderer {
  readonly type = 'flow';
  readonly priority = 70;

  canHandle(content: string): boolean {
    return isFlow(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    try {
      const config = JSON.parse(content) as FlowConfig;
      return React.createElement(FlowView, {
        config,
        className: options?.className ?? 'fmcp-flow-content',
      });
    } catch {
      return React.createElement(Alert, { severity: 'error' }, 'Invalid flow JSON');
    }
  }
}

export const flowRenderer = new FlowRenderer();
