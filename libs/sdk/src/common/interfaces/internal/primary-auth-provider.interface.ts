import { ServerRequest } from '../server.interface';
import { AuthOptions } from '../../types';
import { urlToSafeId } from '../../utils';


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
    if (options.type === 'local') {
      this.id = options.id;
    } else {
      this.id = options.id ?? urlToSafeId(options.baseUrl);
    }

  }

  abstract fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

  abstract validate(request: ServerRequest): Promise<void>

  abstract get issuer(): string
}

export {
  FrontMcpAuth as Auth,
};