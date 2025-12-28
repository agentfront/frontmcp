import { ServerRequest } from '../server.interface';
import {
  AuthOptions,
  TransportConfig,
  DEFAULT_TRANSPORT_CONFIG,
  isPublicMode,
  isTransparentMode,
  isOrchestratedMode,
  isOrchestratedRemote,
} from '../../types';
import { urlToSafeId } from '../../utils';

/**
 * Convert URL to a safe provider ID (hostname with dots replaced)
 * Matches the logic in auth-provider-detection.ts for consistency
 */
function urlToProviderId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/\./g, '_');
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

/**
 * Base class for primary auth provider.
 * Used for easy access current auth context by dependency injection.
 *
 * In tool context, you can access current auth context by calling:
 *  this.get(FrontMcpAuth) | this.get(Auth)
 *
 * Or in session scoped Providers in constructor arguments:
 *  constructor(private readonly auth: FrontMcpAuth) {
 *  // auth.fetch('MY endpoint ')
 *  }
 */
export abstract class FrontMcpAuth<Options extends AuthOptions = AuthOptions> {
  ready: Promise<void>;
  readonly options: Options;
  readonly id: string;

  constructor(options: Options) {
    this.options = options;
    this.id = this.deriveId(options);
  }

  /**
   * Derive the provider ID from options.
   * This logic MUST match deriveProviderId in auth-provider-detection.ts
   * to ensure consistent provider IDs across the system.
   */
  private deriveId(options: AuthOptions): string {
    if (isPublicMode(options)) {
      return options.issuer ?? 'public';
    }

    if (isTransparentMode(options)) {
      return options.remote.id ?? urlToSafeId(options.remote.provider);
    }

    if (isOrchestratedMode(options)) {
      if (isOrchestratedRemote(options)) {
        return options.remote.id ?? urlToSafeId(options.remote.provider);
      }
      // Local orchestrated – match detection defaults
      return options.local?.issuer ?? 'local';
    }

    return 'unknown';
  }

  abstract fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

  abstract validate(request: ServerRequest): Promise<void>;

  abstract get issuer(): string;

  /**
   * Get transport configuration with all defaults applied.
   * Returns default values when transport is not configured.
   * Uses DEFAULT_TRANSPORT_CONFIG as single source of truth for defaults.
   */
  get transport(): TransportConfig {
    return this.options.transport ?? DEFAULT_TRANSPORT_CONFIG;
  }
}

export { FrontMcpAuth as Auth };
