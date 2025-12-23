// file: libs/browser/src/web-components/index.ts
/**
 * Web Components Module
 *
 * Custom Elements wrapper for FrontMCP integration with
 * Shadow DOM encapsulation and reactive properties.
 */

export {
  createFrontMcpElement,
  defineFrontMcpElement,
  isElementDefined,
  whenElementDefined,
  reactiveProperty,
  observeAttribute,
  connectToFrontMcp,
  createFrontMcpStatusElement,
  type FrontMcpElementConfig,
  type FrontMcpElement,
  type ElementLifecycleCallbacks,
} from './frontmcp-element';
