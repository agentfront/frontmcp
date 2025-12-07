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
