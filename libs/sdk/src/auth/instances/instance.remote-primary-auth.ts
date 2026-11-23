import { JwksService } from '@frontmcp/auth';

import { FrontMcpAuth, isPublicUrlPinned, ProviderScope, type ScopeEntry, type ServerRequest } from '../../common';
import { type TransparentAuthOptions } from '../../common/types/options/auth';
import type ProviderRegistry from '../../provider/provider.registry';
import SessionVerifyFlow from '../flows/session.verify.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';

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

  /** Warn once at startup when nothing configures the token audience, so the request host decides it. */
  private warnWithoutConfiguredAudience(scope: ScopeEntry): void {
    // Only the configured list: the Web fetch handler, unlike the Express host, doesn't check FRONTMCP_ALLOWED_HOSTS.
    const protection = scope.metadata.http?.security?.dnsRebindingProtection;
    const checkedHosts = protection?.enabled === false ? undefined : protection?.allowedHosts;
    if (this.options.expectedAudience || isPublicUrlPinned() || checkedHosts?.length) {
      return;
    }
    scope.logger.warn(
      'Transparent auth has no configured token audience, so each token is checked against the host the request ' +
        'names. Set auth.expectedAudience to the audience your identity provider puts in tokens (or set ' +
        'FRONTMCP_PUBLIC_URL, or list the server host in security.dnsRebindingProtection.allowedHosts with that ' +
        'protection on). FrontMCP 1.13 will refuse tokens that carry an aud claim when none of these is set.',
    );
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
