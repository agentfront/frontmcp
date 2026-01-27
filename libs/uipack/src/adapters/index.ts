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
  type ExtAppsMimeTypeVariant,
  // Metadata Types
  type UIMetadata,
  type BuildUIMetaOptions,
  type BuildToolDiscoveryMetaOptions,
  // Builder Functions
  buildUIMeta,
  buildToolDiscoveryMeta,
  buildOpenAICSP,
  buildFrontMCPCSP,
  // MIME Type Utilities
  getExtAppsMimeType,
  isExtAppsMimeType,
} from './platform-meta';

export {
  // Serving Mode Types
  type ResolvedServingMode,
  type ResolveServingModeOptions,
  // Resolver Functions
  resolveServingMode,
  isPlatformModeSupported,
  getDefaultServingMode,
  platformUsesStructuredContent,
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
