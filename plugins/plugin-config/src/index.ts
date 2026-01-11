/**
 * ConfigPlugin - Environment Variable Management for FrontMCP
 *
 * @deprecated Import from '@frontmcp/sdk' instead. ConfigPlugin is now a built-in feature.
 *
 * This package re-exports ConfigPlugin from @frontmcp/sdk for backwards compatibility.
 * New code should import directly from the SDK:
 *
 * @example
 * ```typescript
 * // Recommended - import from SDK
 * import { ConfigPlugin, ConfigService } from '@frontmcp/sdk';
 *
 * // Legacy - still works but deprecated
 * import { ConfigPlugin } from '@frontmcp/plugin-config';
 * ```
 *
 * @packageDocumentation
 */

// Re-export everything from SDK's built-in ConfigPlugin
export {
  ConfigPlugin,
  ConfigPlugin as default,
  ConfigService,
  ConfigMissingError,
  ConfigValidationError,
  ConfigPluginConfigToken,
  getConfig,
  tryGetConfig,
  loadEnvFiles,
  parseEnvContent,
  parseEnvContentSync,
  populateProcessEnv,
} from '@frontmcp/sdk';

export type { ConfigPluginOptions, ConfigPluginOptionsInput, ParsedEnvConfig } from '@frontmcp/sdk';
