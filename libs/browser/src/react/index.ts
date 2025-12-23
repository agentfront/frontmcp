// file: libs/browser/src/react/index.ts
/**
 * @frontmcp/browser/react - React integration for browser MCP server
 *
 * This module provides React hooks and components for integrating the browser
 * MCP server with React applications.
 *
 * @example Basic Usage
 * ```tsx
 * import { FrontMcpProvider, useMcp, useStore, useTool } from '@frontmcp/browser/react';
 * import { BrowserMcpServer } from '@frontmcp/browser';
 *
 * // Create server
 * const server = new BrowserMcpServer({ name: 'my-app', version: '1.0.0' });
 *
 * function App() {
 *   return (
 *     <FrontMcpProvider server={server}>
 *       <MyComponent />
 *     </FrontMcpProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { isConnected } = useMcp();
 *   const { state } = useStore<AppState>();
 *   const { execute, isLoading } = useTool('my-tool');
 *
 *   return (
 *     <div>
 *       <p>Connected: {isConnected ? 'Yes' : 'No'}</p>
 *       <p>Count: {state.count}</p>
 *       <button onClick={() => execute({ action: 'increment' })} disabled={isLoading}>
 *         Increment
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example Page Context for AI Discovery
 * ```tsx
 * import { usePageContext, usePageElement } from '@frontmcp/browser/react';
 *
 * function SignupForm() {
 *   // Register this form for AI discovery
 *   usePageElement({
 *     type: 'form',
 *     name: 'SignupForm',
 *     fields: ['email', 'password'],
 *     actions: ['submit', 'cancel'],
 *   });
 *
 *   return <form>...</form>;
 * }
 * ```
 *
 * @example Human-in-the-Loop
 * ```tsx
 * import { useElicit, ElicitDialog } from '@frontmcp/browser/react';
 *
 * function AppWithElicit() {
 *   const { pendingRequest, respond, dismiss } = useElicit();
 *
 *   return (
 *     <div>
 *       <YourApp />
 *       {pendingRequest && (
 *         <ElicitDialog
 *           request={pendingRequest}
 *           onRespond={respond}
 *           onDismiss={dismiss}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

// Re-export core browser types (not everything, just commonly needed types)
export type { BrowserMcpServer, FrontMcpServer } from '../server';
export type { BrowserTransport } from '../transport';
export type { ComponentRegistry, RendererRegistry, ComponentCategory } from '../registry';

// Context exports
export {
  FrontMcpContext,
  useFrontMcpContext,
  FrontMcpProvider,
  type FrontMcpContextValue,
  type FrontMcpProviderProps,
  type BrowserStore,
  type PageElement,
  type ElicitRequestType,
  type ElicitRequest,
  type ElicitResponse,
  type NotificationEvent,
  // HiTL Context
  HitlContext,
  HitlProvider,
  useHitl,
} from './context';

// Hook exports
export {
  // Store hooks
  useStore,
  useStoreKey,
  type UseStoreResult,

  // Tool hooks
  useTool,
  useToolInfo,
  useToolsList,
  type UseToolResult,

  // Resource hooks
  useResource,
  useResourcesList,
  type UseResourceResult,
  type UseResourceOptions,

  // MCP context hooks
  useMcp,
  useMcpAvailable,
  useMcpStatus,
  type UseMcpResult,

  // Notification hooks
  useNotifyAgent,
  useNavigationNotifier,
  useVisibilityNotifier,
  useFocusNotifier,
  type NotificationEventType,
  type NotifyAgentFn,

  // Page context hooks
  usePageContext,
  usePageElement,
  PageElementTypes,
  createFormElement,
  createTableElement,
  createDialogElement,
  type UsePageContextResult,

  // Component registration hooks
  useRegisterComponent,
  useRegisteredComponents,
  useComponentSearch,
  useComponentsByCategory,
  useComponentsByTag,
  type ComponentRegistration,
  type UseRegisterComponentResult,

  // Elicit hooks
  useElicit,
  formatElicitRequest,
  isConfirmRequest,
  isSelectRequest,
  isInputRequest,
  isFormRequest,
  type UseElicitResult,
} from './hooks';

// Component exports
export {
  ElicitDialog,
  type ElicitDialogProps,
  UIResourceRenderer,
  isUIResource,
  useUIResource,
  type UIResource,
  type UIResourceRendererProps,
} from './components';

// HiTL types (re-exported from hitl module)
export type {
  HitlContextValue,
  HitlProviderProps,
  ConfirmationDialogProps,
  ConfirmationDialogOptions,
  BrowserHitlManagerOptions,
  BrowserAuditLogOptions,
} from '../hitl';
