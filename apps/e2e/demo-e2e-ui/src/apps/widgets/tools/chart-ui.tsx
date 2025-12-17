/**
 * Chart UI Component with Hooks
 *
 * Example demonstrating the use of @frontmcp/ui hooks to access
 * the MCP bridge, tool input/output, and more.
 */

import React from 'react';
import {
  Card,
  Badge,
  McpBridgeProvider,
  useToolInput,
  useToolOutput,
  useTheme,
  useMcpBridgeContext,
} from '@frontmcp/ui/react';

// Type definitions
interface DataPoint {
  label: string;
  value: number;
}

interface ChartInput {
  data: DataPoint[];
  title?: string;
}

interface ChartOutput {
  data: DataPoint[];
  maxValue: number;
}

// Color palette for bars
const BAR_COLORS = ['#4A90D9', '#50C878', '#FFB347', '#FF6B6B', '#9B59B6', '#3498DB'];

/**
 * Get bar color based on index
 */
function getBarColor(index: number): string {
  return BAR_COLORS[index % BAR_COLORS.length];
}

/**
 * Props for ChartCardWithHooks
 *
 * During SSR, the SDK passes structuredContent and input as props.
 * During client-side rendering, hooks are used instead.
 */
interface ChartCardWithHooksProps {
  input?: ChartInput;
  output?: ChartOutput;
  structuredContent?: ChartOutput;
}

/**
 * ChartCardWithHooks - Bar chart display using hooks
 *
 * This component uses hooks to access:
 * - Tool input (chart data and title)
 * - Tool output (processed chart data)
 * - Theme (light/dark mode)
 *
 * During SSR, it uses props passed by the SDK's React template renderer.
 * During client-side rendering, it falls back to hooks for interactivity.
 */
export function ChartCardWithHooks({
  input: ssrInput,
  output: ssrOutput,
  structuredContent,
}: ChartCardWithHooksProps = {}) {
  const { ready } = useMcpBridgeContext();
  const hookOutput = useToolOutput<ChartOutput>();
  const output = structuredContent ?? ssrOutput ?? hookOutput;

  const hookInput = useToolInput<ChartInput>();
  const input = ssrInput ?? hookInput;

  const theme = useTheme();
  const title = input?.title || 'Chart';

  // No data state
  if (!output || !output.data || output.data.length === 0) {
    return (
      <Card title={title} variant={theme === 'dark' ? 'elevated' : 'default'}>
        <div className="text-center py-6">
          <div className="text-5xl font-light text-text-primary mb-3">--</div>
          <p className="text-sm text-text-secondary">No chart data available</p>
        </div>
      </Card>
    );
  }

  const { data, maxValue } = output;

  return (
    <Card
      title={title}
      subtitle={`${data.length} data points`}
      variant={theme === 'dark' ? 'elevated' : 'default'}
      size="md"
      className="max-w-lg mx-auto"
      footer={
        <div className="flex justify-between items-center">
          <p className="text-xs text-text-secondary">Using @frontmcp/ui hooks</p>
          <Badge variant="info" size="sm">
            Max: {maxValue}
          </Badge>
        </div>
      }
    >
      {/* Bar Chart */}
      <div className="py-4">
        <div className="flex items-end justify-center gap-2" style={{ height: '200px' }}>
          {data.map((item, index) => {
            const height = maxValue > 0 ? (item.value / maxValue) * 180 : 0;
            return (
              <div key={index} className="flex flex-col items-center" style={{ flex: 1, maxWidth: '60px' }}>
                <div
                  style={{
                    height: `${Math.max(height, 4)}px`,
                    width: '100%',
                    backgroundColor: getBarColor(index),
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                  title={`${item.label}: ${item.value}`}
                />
                <div className="text-xs mt-2 text-text-secondary truncate w-full text-center">{item.label}</div>
                <div className="text-xs text-text-tertiary">{item.value}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Debug info (only in development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 pt-4 border-t border-divider">
          <details className="text-xs text-text-secondary">
            <summary className="cursor-pointer hover:text-text-primary">Debug Info</summary>
            <pre className="mt-2 p-2 bg-bg-secondary rounded text-left overflow-x-auto">
              {JSON.stringify({ input, output, theme, ready }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  );
}

/**
 * ChartApp - Wrapped component with McpBridgeProvider
 */
export function ChartApp() {
  return (
    <McpBridgeProvider config={{ debug: true }}>
      <ChartCardWithHooks />
    </McpBridgeProvider>
  );
}

export default ChartCardWithHooks;
