import { JwksService } from '@frontmcp/auth';

import { FrontMcpAuth, isPublicUrlPinned, ProviderScope, type ScopeEntry, type ServerRequest } from '../../common';
import { type TransparentAuthOptions } from '../../common/types/options/auth';
import type ProviderRegistry from '../../provider/provider.registry';
import SessionVerifyFlow from '../flows/session.verify.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';
import { acceptsLoopbackAudience, checkedAllowedHosts } from '../transparent-audience';

export class RemotePrimaryAuth extends FrontMcpAuth<TransparentAuthOptions> {
  override ready: Promise<void>;
  private jwks = new JwksService();

  constructor(
    private readonly scope: ScopeEntry,
    private readonly providers: ProviderRegistry,
    options: TransparentAuthOptions,
  ) {
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
    return this.options.provider;
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
    this.warnWithoutConfiguredAudience(scope);
    return Promise.resolve();
  }

  /** Warn once at startup when nothing configures the token audience: say what this server accepts, and what to set. */
  private warnWithoutConfiguredAudience(scope: ScopeEntry): void {
    if (this.options.expectedAudience || isPublicUrlPinned() || checkedAllowedHosts(scope)?.length) {
      return;
    }
    scope.logger.warn(
      `Transparent auth has no configured token audience, so ${this.unconfiguredAudienceBehaviour()}. Set ` +
        'auth.expectedAudience to the audience your identity provider puts in tokens (or set FRONTMCP_PUBLIC_URL, ' +
        'or list the server host in security.dnsRebindingProtection.allowedHosts or FRONTMCP_ALLOWED_HOSTS).',
    );
  }

  private unconfiguredAudienceBehaviour(): string {
    if (this.options.audienceFromRequestHost) {
      return 'each token is checked against the host the request names, which the client chooses (audienceFromRequestHost)';
    }
    if (acceptsLoopbackAudience()) {
      return "tokens that carry an aud claim are accepted only for this server's loopback address (NODE_ENV is development or test)";
    }
    return 'tokens that carry an aud claim are refused (NODE_ENV is not development or test)';
  }

  private async registerAuthFlows(scope: ScopeEntry) {
    await scope.registryFlows(
      WellKnownPrmFlow /** /.well-known/oauth-protected-resource */,
      WellKnownAsFlow /** /.well-known/oauth-authorization-server */,
      WellKnownJwksFlow /** /.well-known/jwks.json */,
      SessionVerifyFlow /** Session verification flow */,
    );
  }
}
