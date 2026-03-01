import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { useRendererTheme } from '../common/use-renderer-theme';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Types
// ============================================

export interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'radar' | 'composed';
  data: Record<string, unknown>[];
  xKey?: string;
  yKeys?: string[];
  colors?: string[];
  labels?: Record<string, string>;
  title?: string;
  width?: number;
  height?: number;
}

// ============================================
// Detection
// ============================================

const CHART_PATTERN = /^\s*\{[\s\S]*"type"\s*:\s*"(?:bar|line|area|pie|scatter|radar|composed)"[\s\S]*"data"\s*:/;

export function isChart(content: string): boolean {
  return CHART_PATTERN.test(content.trim());
}

// ============================================
// Lazy Import
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RechartsModule {
  ResponsiveContainer: React.ComponentType<any>;
  BarChart: React.ComponentType<any>;
  LineChart: React.ComponentType<any>;
  AreaChart: React.ComponentType<any>;
  PieChart: React.ComponentType<any>;
  ScatterChart: React.ComponentType<any>;
  RadarChart: React.ComponentType<any>;
  ComposedChart: React.ComponentType<any>;
  Bar: React.ComponentType<any>;
  Line: React.ComponentType<any>;
  Area: React.ComponentType<any>;
  Pie: React.ComponentType<any>;
  Scatter: React.ComponentType<any>;
  Radar: React.ComponentType<any>;
  XAxis: React.ComponentType<any>;
  YAxis: React.ComponentType<any>;
  CartesianGrid: React.ComponentType<any>;
  Tooltip: React.ComponentType<any>;
  Legend: React.ComponentType<any>;
  PolarGrid: React.ComponentType<any>;
  PolarAngleAxis: React.ComponentType<any>;
  PolarRadiusAxis: React.ComponentType<any>;
  Cell: React.ComponentType<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const lazyRecharts = createLazyImport<RechartsModule>('recharts', async () => {
  const mod = await runtimeImportWithFallback('recharts', esmShUrl('recharts@2', { external: ['react', 'react-dom'] }));
  return mod as unknown as RechartsModule;
});

// ============================================
// Styled Components
// ============================================

const ChartRoot = styled(Box, {
  name: 'FrontMcpChart',
  slot: 'Root',
})(({ theme }) => ({
  width: '100%',
  padding: theme.spacing(2),
}));

// ============================================
// Component
// ============================================

interface ChartViewProps {
  config: ChartData;
  className?: string;
}

function ChartView({ config, className }: ChartViewProps): React.ReactElement {
  const themeValues = useRendererTheme();
  const recharts = useLazyModule(lazyRecharts);

  const colors = useMemo(() => config.colors ?? themeValues.seriesColors, [config.colors, themeValues.seriesColors]);

  if (!recharts) {
    return React.createElement(Alert, { severity: 'info' }, 'Loading chart library...');
  }

  const { ResponsiveContainer, Tooltip, Legend, CartesianGrid, XAxis, YAxis } = recharts;
  const height = config.height ?? 400;
  const xKey = config.xKey ?? 'name';
  const yKeys = config.yKeys ?? Object.keys(config.data[0] ?? {}).filter((k) => k !== xKey);

  const chartContent = renderChartType(
    recharts,
    config.type,
    config.data,
    xKey,
    yKeys,
    colors,
    themeValues.borderRadius,
  );

  return React.createElement(
    ChartRoot,
    { className },
    config.title &&
      React.createElement(
        Typography,
        { variant: 'subtitle1', gutterBottom: true, fontWeight: 600, textAlign: 'center' },
        config.title,
      ),
    React.createElement(ResponsiveContainer, { width: '100%', height }, chartContent),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderChartType(
  rc: RechartsModule,
  type: ChartData['type'],
  data: Record<string, unknown>[],
  xKey: string,
  yKeys: string[],
  colors: string[],
  borderRadius: number,
): React.ReactElement {
  const commonProps: any = { data };
  const grid = React.createElement(rc.CartesianGrid, { strokeDasharray: '3 3', opacity: 0.3 });
  const xAxis = React.createElement(rc.XAxis, { dataKey: xKey });
  const yAxis = React.createElement(rc.YAxis);
  const tooltip = React.createElement(rc.Tooltip, { contentStyle: { borderRadius } });
  const legend = React.createElement(rc.Legend);

  switch (type) {
    case 'bar':
      return React.createElement(
        rc.BarChart,
        commonProps,
        grid,
        xAxis,
        yAxis,
        tooltip,
        legend,
        ...yKeys.map((key, i) =>
          React.createElement(rc.Bar, {
            key,
            dataKey: key,
            fill: colors[i % colors.length],
            radius: [borderRadius, borderRadius, 0, 0],
          }),
        ),
      );

    case 'line':
      return React.createElement(
        rc.LineChart,
        commonProps,
        grid,
        xAxis,
        yAxis,
        tooltip,
        legend,
        ...yKeys.map((key, i) =>
          React.createElement(rc.Line, {
            key,
            type: 'monotone',
            dataKey: key,
            stroke: colors[i % colors.length],
            strokeWidth: 2,
          }),
        ),
      );

    case 'area':
      return React.createElement(
        rc.AreaChart,
        commonProps,
        grid,
        xAxis,
        yAxis,
        tooltip,
        legend,
        ...yKeys.map((key, i) =>
          React.createElement(rc.Area, {
            key,
            type: 'monotone',
            dataKey: key,
            stroke: colors[i % colors.length],
            fill: colors[i % colors.length],
            fillOpacity: 0.3,
          }),
        ),
      );

    case 'pie':
      return React.createElement(
        rc.PieChart,
        {},
        tooltip,
        legend,
        React.createElement(
          rc.Pie,
          { data, dataKey: yKeys[0] ?? 'value', nameKey: xKey, cx: '50%', cy: '50%', outerRadius: '80%', label: true },
          ...data.map((_, i) => React.createElement(rc.Cell, { key: i, fill: colors[i % colors.length] })),
        ),
      );

    case 'scatter':
      return React.createElement(
        rc.ScatterChart,
        {},
        grid,
        xAxis,
        yAxis,
        tooltip,
        legend,
        ...yKeys.map((key, i) =>
          React.createElement(rc.Scatter, { key, name: key, data, fill: colors[i % colors.length] }),
        ),
      );

    case 'radar':
      return React.createElement(
        rc.RadarChart,
        { cx: '50%', cy: '50%', outerRadius: '80%', data },
        React.createElement(rc.PolarGrid),
        React.createElement(rc.PolarAngleAxis, { dataKey: xKey }),
        React.createElement(rc.PolarRadiusAxis),
        tooltip,
        legend,
        ...yKeys.map((key, i) =>
          React.createElement(rc.Radar, {
            key,
            name: key,
            dataKey: key,
            stroke: colors[i % colors.length],
            fill: colors[i % colors.length],
            fillOpacity: 0.3,
          }),
        ),
      );

    case 'composed':
      return React.createElement(
        rc.ComposedChart,
        commonProps,
        grid,
        xAxis,
        yAxis,
        tooltip,
        legend,
        ...yKeys.map((key, i) => {
          // Alternate between bar and line for composed charts
          if (i % 2 === 0) {
            return React.createElement(rc.Bar, {
              key,
              dataKey: key,
              fill: colors[i % colors.length],
              radius: [borderRadius, borderRadius, 0, 0],
            });
          }
          return React.createElement(rc.Line, {
            key,
            type: 'monotone',
            dataKey: key,
            stroke: colors[i % colors.length],
            strokeWidth: 2,
          });
        }),
      );

    default:
      return React.createElement(rc.BarChart, commonProps, grid, xAxis, yAxis, tooltip, legend);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Eagerly start loading recharts
lazyRecharts.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderer
// ============================================

export class ChartsRenderer implements ContentRenderer {
  readonly type = 'chart';
  readonly priority = 80;

  canHandle(content: string): boolean {
    return isChart(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    try {
      const config = JSON.parse(content) as ChartData;
      return React.createElement(ChartView, {
        config,
        className: options?.className ?? 'fmcp-chart-content',
      });
    } catch {
      return React.createElement(Alert, { severity: 'error' }, 'Invalid chart JSON');
    }
  }
}

export const chartsRenderer = new ChartsRenderer();
