/**
 * @file index.ts
 * @description React components and hooks for FrontMCP UI.
 *
 * These are pure React components that can be used:
 * 1. As regular React components in your app
 * 2. To generate static HTML via render functions
 * 3. With hooks to access the MCP bridge
 *
 * @example React usage
 * ```tsx
 * import { Card, Badge, Button, Alert } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <Card title="Welcome" variant="elevated">
 *       <Badge variant="success">New</Badge>
 *       <p>Card content here</p>
 *       <Button variant="primary">Click Me</Button>
 *     </Card>
 *   );
 * }
 * ```
 *
 * @example Static HTML generation
 * ```typescript
 * import { renderCard, renderBadge } from '@frontmcp/ui/react';
 *
 * const cardHtml = await renderCard({
 *   title: 'Welcome',
 *   variant: 'elevated',
 *   children: '<p>Content</p>',
 * });
 * ```
 *
 * @example Using hooks with the MCP bridge
 * ```tsx
 * import {
 *   McpBridgeProvider,
 *   useMcpBridge,
 *   useToolInput,
 *   useCallTool,
 *   useTheme,
 * } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <McpBridgeProvider>
 *       <WeatherWidget />
 *     </McpBridgeProvider>
 *   );
 * }
 *
 * function WeatherWidget() {
 *   const input = useToolInput<{ location: string }>();
 *   const theme = useTheme();
 *   const [getWeather, { data, loading }] = useCallTool('get_weather');
 *
 *   return (
 *     <Card title={`Weather for ${input?.location}`} variant={theme === 'dark' ? 'elevated' : 'default'}>
 *       {loading ? 'Loading...' : data?.temperature}
 *     </Card>
 *   );
 * }
 * ```
 *
 * @module @frontmcp/ui/react
 */

// React Components
export { Card, renderCard, renderCardSync } from './Card';
export { Badge, renderBadge, renderBadgeSync } from './Badge';
export { Button, renderButton, renderButtonSync } from './Button';
export { Alert, renderAlert, renderAlertSync } from './Alert';

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

// Component Types
export type { CardProps, CardRenderProps, CardVariant, CardSize } from './Card';
export type { BadgeProps, BadgeRenderProps, BadgeVariant, BadgeSize } from './Badge';
export type { ButtonProps, ButtonRenderProps, ButtonVariant, ButtonSize } from './Button';
export type { AlertProps, AlertRenderProps, AlertVariant } from './Alert';

// Note: ButtonProps and AlertProps are now exported from the new .tsx files above
// The types.ts file is deprecated

// Legacy web component types (deprecated, will be removed)
export type { FmcpCard, FmcpBadge, FmcpButton, FmcpAlert } from './types';

// Legacy schema types (deprecated, use styles/variants instead)
export type { CardOptions, BadgeOptions, ButtonOptions, AlertOptions } from './types';

// Utilities (deprecated, use render/prerender instead)
export { renderChildrenToString, isBrowser, isServer } from './utils';
