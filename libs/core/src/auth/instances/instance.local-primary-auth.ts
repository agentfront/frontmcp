import { FrontMcpAuth, LocalAuthOptions, ServerRequest } from '@frontmcp/sdk';
import { URL } from 'url';
import ProviderRegistry from '../../provider/provider.registry';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import SessionVerifyFlow from '../flows/session.verify.flow';

export class LocalPrimaryAuth extends FrontMcpAuth {
  override get issuer(): string {
    throw new Error('Method not implemented.');
  }

  constructor(private providers: ProviderRegistry, metadata: LocalAuthOptions) {
    super(metadata);

    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    await this.registerAuthFlows();
    return Promise.resolve();
  }

  override fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  override validate(request: ServerRequest): Promise<void> {
    return Promise.resolve();
  }


  private async registerAuthFlows() {
    const scope = this.providers.getActiveScope();
    await scope.registryFlows(
      WellKnownPrmFlow, /** /.well-known/oauth-protected-resource */
      WellKnownAsFlow, /** /.well-known/oauth-authorization-server */
      WellKnownJwksFlow, /** /.well-known/jwks.json */
      SessionVerifyFlow, /** Session verification flow */
    );
  }
}