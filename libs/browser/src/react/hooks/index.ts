// file: libs/browser/src/react/hooks/index.ts
/**
 * React hooks for FrontMCP browser integration.
 */

export { useStore, useStoreKey, type UseStoreResult } from './useStore';

export { useTool, useToolInfo, useToolsList, type UseToolResult } from './useTool';

export { useResource, useResourcesList, type UseResourceResult, type UseResourceOptions } from './useResource';

export { useMcp, useMcpAvailable, useMcpStatus, type UseMcpResult } from './useMcp';

export {
  useNotifyAgent,
  useNavigationNotifier,
  useVisibilityNotifier,
  useFocusNotifier,
  type NotificationEventType,
  type NotifyAgentFn,
} from './useNotifyAgent';

export {
  usePageContext,
  usePageElement,
  PageElementTypes,
  createFormElement,
  createTableElement,
  createDialogElement,
  type UsePageContextResult,
} from './usePageContext';

export {
  useRegisterComponent,
  useRegisteredComponents,
  useComponentSearch,
  useComponentsByCategory,
  useComponentsByTag,
  type ComponentRegistration,
  type UseRegisterComponentResult,
} from './useRegisterComponent';

export {
  useElicit,
  formatElicitRequest,
  isConfirmRequest,
  isSelectRequest,
  isInputRequest,
  isFormRequest,
  type UseElicitResult,
} from './useElicit';
