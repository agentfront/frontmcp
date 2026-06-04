/**
 * Secure-store DI Providers (#470)
 *
 * Registers the per-request {@link SecureStoreAccessor} (`this.secureStore`).
 * The backend is a GLOBAL singleton owned by LocalPrimaryAuth; the accessor is
 * CONTEXT-scoped because it must resolve the CURRENT request's namespace (the
 * authenticated `sub` for `user` scope, the transport `sessionId` for `session`
 * scope) before calling the backend.
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
import { resolveRequestSub } from '../credentials/credentials.providers';

/**
 * GLOBAL DI token for the secure-store backend singleton. Provided by
 * LocalPrimaryAuth once the backing is initialized.
 */
export const SECURE_STORE_BACKEND = Symbol.for('frontmcp:SECURE_STORE_BACKEND') as Token<SecureStoreBackend>;

/**
 * Resolve the transport session id for the current request, or undefined when
 * there is no session. Used for `session`-scoped secrets.
 */
export function resolveRequestSessionId(ctx: FrontMcpContext): string | undefined {
  const sid = ctx.sessionId;
  return typeof sid === 'string' && sid.length > 0 ? sid : undefined;
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
