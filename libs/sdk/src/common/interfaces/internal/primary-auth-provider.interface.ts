import { ServerRequest } from '../server.interface';
import { urlToSafeId } from '../../utils';
import { AuthOptions, isPublicMode, isTransparentMode, isOrchestratedMode, isOrchestratedLocal } from '../../types';

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
   * Derive the provider ID from options
   */
  private deriveId(options: AuthOptions): string {
    if (isPublicMode(options)) {
      return options.issuer ?? 'public';
    }

    if (isTransparentMode(options)) {
      return options.remote.id ?? urlToSafeId(options.remote.provider);
    }

    if (isOrchestratedMode(options)) {
      if (isOrchestratedLocal(options)) {
        return options.local?.issuer ?? 'orchestrated-local';
      } else {
        return options.local?.issuer ?? options.remote.id ?? urlToSafeId(options.remote.provider);
      }
    }

    return 'default';
  }

  abstract fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

  abstract validate(request: ServerRequest): Promise<void>;

  abstract get issuer(): string;
}

export { FrontMcpAuth as Auth };
