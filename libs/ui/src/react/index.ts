/**
 * @frontmcp/ui/react
 *
 * React hooks for MCP bridge integration.
 *
 * @example Using hooks with the MCP bridge
 * ```tsx
 * import {
 *   McpBridgeProvider,
 *   useMcpBridge,
 *   useToolInput,
 *   useCallTool,
 * } from '@frontmcp/ui/react';
 *
 * function WeatherWidget() {
 *   const input = useToolInput<{ location: string }>();
 *   const [getWeather, { data, loading }] = useCallTool('get_weather');
 *   return <div>{loading ? 'Loading...' : data?.temperature}</div>;
 * }
 *
 * function App() {
 *   return (
 *     <McpBridgeProvider>
 *       <WeatherWidget />
 *     </McpBridgeProvider>
 *   );
 * }
 * ```
 *
 * @module @frontmcp/ui/react
 */

// React Hooks for MCP Bridge
export {
  // Provider
  McpBridgeProvider,
  // Bridge hooks
  useMcpBridgeContext,
  useMcpBridge,
  useTheme,
  useDisplayMode,
  useHostContext,
  useCapability,
  // Tool hooks
  useToolInput,
  useToolOutput,
  useStructuredContent,
  useCallTool,
  useToolCalls,
  useSendMessage,
  useOpenLink,
  // Types
  type McpBridgeContextValue,
  type McpBridgeProviderProps,
  type ToolState,
  type UseCallToolOptions,
  type UseCallToolReturn,
} from './hooks';
