// file: libs/browser/src/react/context/index.ts
/**
 * React context exports for FrontMCP browser integration.
 */

export {
  FrontMcpContext,
  useFrontMcpContext,
  type FrontMcpContextValue,
  type BrowserStore,
  type PageElement,
  type ElicitRequestType,
  type ElicitRequest,
  type ElicitResponse,
  type NotificationEvent,
} from './context';

export { FrontMcpProvider, type FrontMcpProviderProps } from './FrontMcpProvider';

// HiTL Context
export { HitlContext, HitlProvider, useHitl } from './HitlContext';
