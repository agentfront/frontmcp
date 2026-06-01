/**
 * Credentials DI Providers (Checkpoint 3b)
 *
 * Registers the per-request {@link CredentialsAccessor} (`this.credentials`).
 * The vault itself is a GLOBAL singleton owned by LocalPrimaryAuth; the accessor
 * is CONTEXT-scoped because it must resolve the CURRENT request's authenticated
 * subject (from {@link FrontMcpContext}) before reading the vault.
 */

import { CREDENTIALS_ACCESSOR, CredentialsAccessorImpl, type SessionCredentialVault } from '@frontmcp/auth';
import { ProviderScope, type Token } from '@frontmcp/di';

import { FrontMcpLogger, type ProviderType } from '../../common';
import { type FrontMcpContext } from '../../context/frontmcp-context';
import { FRONTMCP_CONTEXT } from '../../context/frontmcp-context.provider';

/**
 * GLOBAL DI token for the per-session credential vault singleton. Provided by
 * LocalPrimaryAuth once its storage backend is initialized.
 */
export const SESSION_CREDENTIAL_VAULT = Symbol.for(
  'frontmcp:SESSION_CREDENTIAL_VAULT',
) as Token<SessionCredentialVault>;

/**
 * Resolve the authenticated subject for the current request from the verified
 * auth info. The HTTP request flow stores the verified JWT user under
 * `authInfo.extra.user`; the JWT `sub` is the credential-vault key. Anonymous
 * sessions (`sub` empty or `anon:` prefixed) yield undefined so no credentials
 * are exposed.
 */
export function resolveRequestSub(ctx: FrontMcpContext): string | undefined {
  const extra = ctx.authInfo?.extra as { user?: { sub?: unknown } } | undefined;
  const sub = extra?.user?.sub;
  if (typeof sub !== 'string' || sub.length === 0 || sub.startsWith('anon:')) {
    return undefined;
  }
  return sub;
}

/**
 * Build the DI providers that back `this.credentials`.
 *
 * @param vault - the GLOBAL credential vault singleton.
 * @param signingSecret - server HMAC secret used to sign resume tokens.
 * @param basePath - auth scope base path used to build resume URLs.
 * @param resumeTtlMs - optional resume-token TTL override.
 */
export function createCredentialsProviders(opts: {
  vault: SessionCredentialVault;
  signingSecret: string;
  basePath: string;
  resumeTtlMs?: number;
}): ProviderType[] {
  const { vault, signingSecret, basePath, resumeTtlMs } = opts;

  // GLOBAL: the vault singleton (so other features can resolve it too).
  const vaultProvider: ProviderType = {
    provide: SESSION_CREDENTIAL_VAULT as Token,
    useValue: vault,
    scope: ProviderScope.GLOBAL,
    name: 'SessionCredentialVault',
  };

  // CONTEXT: the per-request accessor bound to the request's subject.
  const accessorProvider: ProviderType = {
    provide: CREDENTIALS_ACCESSOR as Token,
    inject: () => [FRONTMCP_CONTEXT, FrontMcpLogger] as const,
    useFactory: (ctx: FrontMcpContext, logger: FrontMcpLogger) =>
      new CredentialsAccessorImpl({
        vault,
        resolveSub: () => resolveRequestSub(ctx),
        signingSecret,
        basePath,
        resumeTtlMs,
        logger: logger.child('CredentialsAccessor'),
      }),
    scope: ProviderScope.CONTEXT,
    name: 'CredentialsAccessor',
  };

  return [vaultProvider, accessorProvider];
}
