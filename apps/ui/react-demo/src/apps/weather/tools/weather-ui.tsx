/**
 * Weather UI Component with Hooks
 *
 * Example demonstrating the use of @frontmcp/ui hooks to access
 * the MCP bridge, tool input/output, and more.
 *
 * This version uses hooks instead of props, making the component
 * more self-contained and easier to use.
 */

import React, { useState } from 'react';
import {
  Card,
  Badge,
  // Hooks
  McpBridgeProvider,
  useToolInput,
  useToolOutput,
  useTheme,
  useCallTool,
  useMcpBridgeContext,
} from '@frontmcp/ui/react';

// Weather icon mapping (using emoji for simplicity)
const iconMap: Record<string, string> = {
  sunny: '\u2600\uFE0F',
  cloudy: '\u2601\uFE0F',
  rainy: '\uD83C\uDF27\uFE0F',
  snowy: '\u2744\uFE0F',
  stormy: '\u26C8\uFE0F',
  windy: '\uD83D\uDCA8',
  foggy: '\uD83C\uDF2B\uFE0F',
};

// Type definitions
interface WeatherInput {
  location: string;
}

interface WeatherOutput {
  location: string;
  temperature: number;
  units: 'celsius' | 'fahrenheit';
  conditions: string;
  humidity: number;
  windSpeed: number;
  icon: string;
}

/**
 * Get badge variant based on weather conditions
 */
function getConditionBadgeVariant(conditions: string): 'success' | 'info' | 'warning' | 'default' {
  switch (conditions) {
    case 'sunny':
      return 'success';
    case 'rainy':
    case 'snowy':
      return 'info';
    case 'stormy':
      return 'warning';
    default:
      return 'default';
  }
}

/**
 * Props for WeatherCardWithHooks
 *
 * During SSR, the SDK passes structuredContent and input as props.
 * During client-side rendering, hooks are used instead.
 */
interface WeatherCardWithHooksProps {
  /** Tool input passed by SDK during SSR */
  input?: WeatherInput;
  /** Tool output passed by SDK during SSR (same as structuredContent) */
  output?: WeatherOutput;
  /** Structured content from tool execution - passed by SDK during SSR */
  structuredContent?: WeatherOutput;
}

/**
 * WeatherCardWithHooks - Weather display using hooks
 *
 * This component uses hooks to access:
 * - Tool input (location from the initial call)
 * - Tool output (weather data)
 * - Theme (light/dark mode)
 * - The ability to call other tools
 *
 * During SSR, it uses props passed by the SDK's React template renderer.
 * During client-side rendering, it falls back to hooks for interactivity.
 */
export function WeatherCardWithHooks({
  input: ssrInput,
  output: ssrOutput,
  structuredContent,
}: WeatherCardWithHooksProps = {}) {
  // Get bridge context (used for client-side state)
  const { ready } = useMcpBridgeContext();
  // Get tool output - prefer structuredContent (SSR), then ssrOutput, then hooks
  const hookOutput = useToolOutput<WeatherOutput>();

  const [output, setOutput] = useState(structuredContent ?? ssrOutput ?? hookOutput);

  // Get tool input - prefer SSR props, fall back to hooks for client-side
  const hookInput = useToolInput<WeatherInput>();
  const input = ssrInput ?? hookInput;

  // Get current theme from the host platform
  const theme = useTheme();

  // Hook to call another tool (e.g., to refresh weather)
  const [refreshWeather, { loading: refreshing }] = useCallTool<WeatherInput, WeatherOutput>('get_weather', {
    onSuccess: (output: any) => {
      setOutput(output.structuredContent);
    },
  });

  // No data state - show placeholder when no output available
  // Note: During SSR, bridgeLoading/bridgeError don't matter if we have structuredContent
  if (!output) {
    return (
      <Card title={input?.location ?? 'Weather'} variant={theme === 'dark' ? 'elevated' : 'default'}>
        <div className="text-center py-6">
          <div className="text-5xl font-light text-text-primary mb-3">--</div>
          <p className="text-sm text-text-secondary">No weather data available</p>
        </div>
      </Card>
    );
  }

  // Render weather data
  const tempSymbol = output.units === 'celsius' ? '\u00B0C' : '\u00B0F';
  const weatherIcon = iconMap[output.icon] || '\uD83C\uDF24\uFE0F';

  return (
    <Card
      title={output.location}
      subtitle="Current Weather"
      variant={theme === 'dark' ? 'elevated' : 'default'}
      size="md"
      className="max-w-sm mx-auto"
      footer={
        <div className="flex justify-between items-center">
          <p className="text-xs text-text-secondary">Using @frontmcp/ui hooks</p>
          {/*
            Use a native button with inline onclick for SSR compatibility.
            React's onClick won't work in OpenAI's iframe since there's no hydration.
            The button calls window.__frontmcp.callTool() which is provided by the base template.
          */}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md text-xs font-medium px-2 py-1 bg-transparent hover:bg-bg-secondary text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => {
              // Client-side React handler (works if hydrated)
              if (typeof refreshWeather === 'function') {
                refreshWeather({ location: output.location });
              }
            }}
            // SSR-safe onclick using data attribute + inline script
            data-tool-call="get_weather"
            data-tool-args={JSON.stringify({ location: output.location })}
          >
            {refreshing ? <span className="animate-spin mr-1">⏳</span> : <span className="mr-1">🔄</span>}
            Refresh
          </button>
        </div>
      }
    >
      {/* Temperature display */}
      <div className="text-center py-6">
        <div className="text-6xl mb-4">{weatherIcon}</div>
        <div className="text-5xl font-light text-text-primary mb-3">
          {output.temperature}
          {tempSymbol}
        </div>
        <Badge variant={getConditionBadgeVariant(output.conditions)} size="lg" pill>
          {output.conditions}
        </Badge>
      </div>

      {/* Weather details */}
      <div className="border-t border-divider pt-4">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-sm font-medium text-text-secondary">Humidity</div>
            <div className="text-lg font-semibold text-text-primary">{output.humidity}%</div>
          </div>
          <div>
            <div className="text-sm font-medium text-text-secondary">Wind Speed</div>
            <div className="text-lg font-semibold text-text-primary">{output.windSpeed} km/h</div>
          </div>
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
 * WeatherApp - Wrapped component with McpBridgeProvider
 *
 * This wrapper includes the provider for standalone/client-side use.
 * For SSR, use WeatherCardWithHooks directly (the default export).
 */
export function WeatherApp() {
  return (
    <McpBridgeProvider config={{ debug: true }}>
      <WeatherCardWithHooks />
    </McpBridgeProvider>
  );
}

// Default export is the component that accepts SSR props directly.
// The SDK's React renderer passes { input, output, structuredContent, helpers } as props.
// WeatherApp would swallow these props, so we export WeatherCardWithHooks directly.
export default WeatherCardWithHooks;
