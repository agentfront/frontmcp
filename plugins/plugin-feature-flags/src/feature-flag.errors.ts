/**
 * Error classes for the feature-flag plugin.
 *
 * A refusal is an answer for the caller, so it is a public MCP error whose message reaches the
 * client as written, in every environment, instead of being wrapped as an internal server error.
 *
 * @module @frontmcp/plugin-feature-flags
 */

import { PublicMcpError } from '@frontmcp/sdk';

/**
 * Raised when a tool, resource, prompt or agent is called while its feature flag is off.
 */
export class FeatureFlagDisabledError extends PublicMcpError {
  override readonly name = 'FeatureFlagDisabledError';

  constructor(
    public readonly kind: string,
    public readonly entryName: string | undefined,
    public readonly flagKey: string,
  ) {
    super(`${kind} "${entryName}" is disabled by feature flag "${flagKey}"`, 'FEATURE_FLAG_DISABLED', 403);
  }
}

/**
 * Raised at startup when `FeatureFlagPlugin.init()` is given no usable adapter.
 */
export class FeatureFlagConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureFlagConfigurationError';
  }
}
