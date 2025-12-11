/**
 * @file index.ts
 * @description React hooks for FrontMCP bridge and tools.
 *
 * @example Provider setup
 * ```tsx
 * import { McpBridgeProvider } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <McpBridgeProvider>
 *       <MyWidget />
 *     </McpBridgeProvider>
 *   );
 * }
 * ```
 *
 * @example Using hooks
 * ```tsx
 * import {
 *   useMcpBridge,
 *   useToolInput,
 *   useToolOutput,
 *   useCallTool,
 *   useTheme,
 * } from '@frontmcp/ui/react';
 *
 * function MyWidget() {
 *   const bridge = useMcpBridge();
 *   const input = useToolInput<{ location: string }>();
 *   const theme = useTheme();
 *   const [callTool, { data, loading }] = useCallTool('my_tool');
 *
 *   return <div>...</div>;
 * }
 * ```
 *
 * @module @frontmcp/ui/react/hooks
 */

// Context and Provider
export {
  McpBridgeProvider,
  useMcpBridgeContext,
  useMcpBridge,
  useTheme,
  useDisplayMode,
  useHostContext,
  useCapability,
  type McpBridgeContextValue,
  type McpBridgeProviderProps,
} from './context';

// Tool Hooks
export {
  useToolInput,
  useToolOutput,
  useStructuredContent,
  useCallTool,
  useToolCalls,
  useSendMessage,
  useOpenLink,
  type ToolState,
  type UseCallToolOptions,
  type UseCallToolReturn,
} from './tools';
