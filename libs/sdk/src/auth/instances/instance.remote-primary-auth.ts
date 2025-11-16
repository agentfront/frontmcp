import {FrontMcpAuth, ProviderScope, RemoteAuthOptions, ScopeEntry, ServerRequest} from '../../common';
import {URL} from 'url';
import ProviderRegistry from '../../provider/provider.registry';
import {JwksService} from '../jwks';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import SessionVerifyFlow from '../flows/session.verify.flow';
import {Scope} from '../../scope';


export class RemotePrimaryAuth extends FrontMcpAuth<RemoteAuthOptions> {
  override ready: Promise<void>;
  private jwks = new JwksService();

  constructor(private readonly scope: ScopeEntry, private readonly providers: ProviderRegistry, options: RemoteAuthOptions) {
    super(options);
    this.ready = this.initialize();
  }

  override fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  override validate(request: ServerRequest): Promise<void> {
    return Promise.resolve();
  }


  get issuer(): string {
    return this.options.baseUrl;
  }

  protected async initialize() {
    const scope = this.providers.getActiveScope();

    this.providers.injectProvider({
      value: this.jwks,
      metadata: {
        scope: ProviderScope.GLOBAL,
        name: 'auth:jwk-service',
      },
      provide: JwksService,
    });

    await this.registerAuthFlows(scope);
    return Promise.resolve();
  }


  private async registerAuthFlows(scope: Scope) {
    await scope.registryFlows(
      WellKnownPrmFlow, /** /.well-known/oauth-protected-resource */
      WellKnownAsFlow, /** /.well-known/oauth-authorization-server */
      WellKnownJwksFlow, /** /.well-known/jwks.json */
      SessionVerifyFlow, /** Session verification flow */
    );
  }
}