/**
 * @frontmcp/ui Adapters
 *
 * Platform-specific adapters for building UI metadata.
 * These adapters are SDK-independent and can be used by external systems
 * like AgentLink without requiring @frontmcp/sdk.
 *
 * @packageDocumentation
 */

export {
  // Platform Types
  type AIPlatformType,
  // Metadata Types
  type UIMetadata,
  type BuildUIMetaOptions,
  type BuildToolDiscoveryMetaOptions,
  // Builder Functions
  buildUIMeta,
  buildToolDiscoveryMeta,
  buildOpenAICSP,
} from './platform-meta';

export {
  // Dual-Payload Types
  type TextContent,
  type DualPayloadOptions,
  type DualPayloadResult,
  // Constants
  DEFAULT_HTML_PREFIX,
  // Builder Functions
  buildDualPayload,
  // Validation Helpers
  isDualPayload,
  parseDualPayload,
} from './dual-payload';

export {
  // Serving Mode Types
  type ResolvedServingMode,
  type ResolveServingModeOptions,
  // Resolver Functions
  resolveServingMode,
  isPlatformModeSupported,
  getDefaultServingMode,
  platformUsesDualPayload,
  platformSupportsWidgets,
} from './serving-mode';

export {
  // Response Builder Types
  type TextContentBlock,
  type BuildToolResponseOptions,
  type ToolResponseContent,
  // Builder Functions
  buildToolResponseContent,
} from './response-builder';
