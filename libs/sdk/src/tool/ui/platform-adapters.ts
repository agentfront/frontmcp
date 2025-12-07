/**
 * Platform Adapters
 *
 * Re-exports platform adapter functions from @frontmcp/ui/adapters for SDK consumers.
 * This provides a single source of truth for platform-specific metadata building
 * while maintaining backwards compatibility.
 *
 * @see {@link https://docs.agentfront.dev/docs/servers/tools#tool-ui | Tool UI Documentation}
 */

// Re-export platform adapter types and functions from @frontmcp/ui
export {
  type AIPlatformType,
  type UIMetadata,
  type BuildUIMetaOptions,
  type BuildToolDiscoveryMetaOptions,
  buildUIMeta,
  buildToolDiscoveryMeta,
  buildOpenAICSP,
} from '@frontmcp/ui/adapters';
