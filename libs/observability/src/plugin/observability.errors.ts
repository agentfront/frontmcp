import { InternalMcpError } from '@frontmcp/sdk';

/** Raised when `ObservabilityPlugin.init()` or `@FrontMcp({ observability })` is given options it cannot honour. */
export class ObservabilityConfigurationError extends InternalMcpError {
  override readonly name = 'ObservabilityConfigurationError';

  constructor(message: string) {
    super(message, 'OBSERVABILITY_CONFIGURATION');
  }
}
