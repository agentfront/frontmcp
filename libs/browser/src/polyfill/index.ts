// file: libs/browser/src/polyfill/index.ts
/**
 * Navigator Model Context Polyfill
 *
 * Import this module to install the navigator.modelContext polyfill:
 *
 * ```typescript
 * import '@frontmcp/browser/polyfill';
 * ```
 *
 * Or import specific utilities:
 *
 * ```typescript
 * import { cleanup, isInstalled, getPolyfillVersion } from '@frontmcp/browser/polyfill';
 * ```
 */

// Auto-install polyfill on import
import './navigator-model-context';

// Export utilities
export { cleanup, isInstalled, getPolyfillVersion } from './navigator-model-context';

// Export types
export type {
  NavigatorModelContext,
  ConnectOptions,
  ModelContextSession,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  PromptArgument,
  ServerInfo,
  ClientInfo,
  TransportConfig,
  ModelContextCapabilities,
  SessionState,
  SessionEventType,
  ToolMeta,
  JSONSchema,
} from './types';

// Export error classes (as both values and types)
export {
  ModelContextConnectionError,
  ModelContextTimeoutError,
  ToolRegistrationError,
  ResourceRegistrationError,
  PromptRegistrationError,
} from './types';
