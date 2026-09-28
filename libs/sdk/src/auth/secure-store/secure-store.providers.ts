/**
 * Secure-store DI Providers (#470)
 *
 * Registers the per-request {@link SecureStoreAccessor} (`this.secureStore`).
 * The backend is a GLOBAL singleton owned by LocalPrimaryAuth; the accessor is
 * CONTEXT-scoped because it must resolve the CURRENT request's namespace (the
 * authenticated `sub` for `user` scope, the verified session, else the signed-in
 * caller, for `session` scope) before calling the backend.
 */

import {
  SECURE_STORE_ACCESSOR,
  SecureStoreAccessorImpl,
  type SecureStoreBackend,
  type SecureStoreScope,
} from '@frontmcp/auth';
import { ProviderScope, type Token } from '@frontmcp/di';

import { FrontMcpLogger, type ProviderType } from '../../common';
import { type FrontMcpContext } from '../../context/frontmcp-context';
import { FRONTMCP_CONTEXT } from '../../context/frontmcp-context.provider';
import { SessionIdentityRequiredError } from '../../errors/session-identity-required.error';
import { resolveRequestSub } from '../credentials/credentials.providers';
import { sessionScopeIdentity } from '../session-scope-identity';

/**
 * GLOBAL DI token for the secure-store backend singleton. Provided by
 * LocalPrimaryAuth once the backing is initialized.
 */
export const SECURE_STORE_BACKEND = Symbol.for('frontmcp:SECURE_STORE_BACKEND') as Token<SecureStoreBackend>;

/**
 * The identity `session`-scoped secrets of the current request belong to: the session the server
 * verified, else the signed-in caller (see {@link sessionScopeIdentity}).
 *
 * @throws SessionIdentityRequiredError for an anonymous caller without a verified session, which no
 *   later request could be matched to
 */
export function resolveRequestSessionId(ctx: FrontMcpContext): string {
  const identity = sessionScopeIdentity(ctx);
  if (identity) return identity;
  throw new SessionIdentityRequiredError("The secure store's session scope");
}

/**
 * Build the DI providers that back `this.secureStore`.
 *
 * @param backend - the GLOBAL secure-store backend singleton.
 * @param scope - the configured namespace scope (`user` | `session` | `global`).
 * @param ttlMs - optional default TTL applied to writes.
 */
export function createSecureStoreProviders(opts: {
  backend: SecureStoreBackend;
  scope: SecureStoreScope;
  ttlMs?: number;
}): ProviderType[] {
  const { backend, scope, ttlMs } = opts;

  // GLOBAL: the backend singleton (so other features can resolve it too).
  const backendProvider: ProviderType = {
    provide: SECURE_STORE_BACKEND as Token,
    useValue: backend,
    scope: ProviderScope.GLOBAL,
    name: 'SecureStoreBackend',
  };

  // CONTEXT: the per-request accessor bound to the request's resolved namespace.
  const accessorProvider: ProviderType = {
    provide: SECURE_STORE_ACCESSOR as Token,
    inject: () => [FRONTMCP_CONTEXT, FrontMcpLogger] as const,
    useFactory: (ctx: FrontMcpContext, logger: FrontMcpLogger) =>
      new SecureStoreAccessorImpl({
        backend,
        scope,
        resolveSub: () => resolveRequestSub(ctx),
        resolveSessionId: () => resolveRequestSessionId(ctx),
        ttlMs,
        logger: logger.child('SecureStore'),
      }),
    scope: ProviderScope.CONTEXT,
    name: 'SecureStoreAccessor',
  };

  return [backendProvider, accessorProvider];
}
