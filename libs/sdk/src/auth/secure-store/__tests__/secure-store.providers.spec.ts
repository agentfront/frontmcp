/**
 * Secure-store providers — resolveRequestSessionId + createSecureStoreProviders
 * (#470).
 *
 * Asserts the session-scope identity resolution (used by `this.secureStore` for
 * the `session` scope) and the DI provider wiring (backend GLOBAL value + accessor
 * CONTEXT factory). The accessor factory is invoked to prove it constructs a
 * working SecureStoreAccessorImpl bound to the request.
 */
import 'reflect-metadata';

import { SECURE_STORE_ACCESSOR, type SecureStoreAccessor, type SecureStoreBackend } from '@frontmcp/auth';

import type { FrontMcpContext } from '../../../context/frontmcp-context';
import { SessionIdentityRequiredError } from '../../../errors';
import { createSecureStoreProviders, resolveRequestSessionId, SECURE_STORE_BACKEND } from '../secure-store.providers';

function ctxWith(partial: Partial<FrontMcpContext>): FrontMcpContext {
  return partial as FrontMcpContext;
}

describe('resolveRequestSessionId', () => {
  it('is the session the server verified', () => {
    expect(resolveRequestSessionId(ctxWith({ sessionId: 'sess-1', verifiedSessionId: 'sess-1' }))).toBe('sess-1');
  });

  it('is the signed-in caller for a request without a verified session, never the id it sent', () => {
    const ctx = ctxWith({ sessionId: 'sent-by-the-client', authInfo: { extra: { user: { sub: 'user-9' } } } as never });

    expect(resolveRequestSessionId(ctx)).toBe('principal:user-9');
  });

  it('refuses an anonymous caller without a verified session', () => {
    const anonymous = ctxWith({ sessionId: 'sent', authInfo: { extra: { user: { sub: 'anon:1f2e' } } } as never });

    expect(() => resolveRequestSessionId(anonymous)).toThrow(SessionIdentityRequiredError);
    expect(() => resolveRequestSessionId(ctxWith({}))).toThrow(SessionIdentityRequiredError);
  });
});

describe('createSecureStoreProviders', () => {
  const backend: SecureStoreBackend = {
    get: async () => null,
    set: async () => undefined,
    delete: async () => false,
    list: async () => [],
  };

  it('wires a GLOBAL backend value provider and a CONTEXT accessor factory', () => {
    const providers = createSecureStoreProviders({ backend, scope: 'user' });
    expect(providers).toHaveLength(2);

    const backendProvider = providers.find((p) => 'provide' in p && p.provide === SECURE_STORE_BACKEND) as Record<
      string,
      unknown
    >;
    expect(backendProvider).toBeTruthy();
    expect(backendProvider['useValue']).toBe(backend);
    expect(backendProvider['scope']).toBe('global');

    const accessorProvider = providers.find((p) => 'provide' in p && p.provide === SECURE_STORE_ACCESSOR) as Record<
      string,
      unknown
    >;
    expect(accessorProvider).toBeTruthy();
    expect(typeof accessorProvider['useFactory']).toBe('function');
    expect(typeof accessorProvider['inject']).toBe('function');
    expect(accessorProvider['scope']).toBe('context');
  });

  it('the accessor factory builds a working accessor bound to the request', async () => {
    const store = new Map<string, string>();
    const memBackend: SecureStoreBackend = {
      get: async (ns, key) => store.get(`${ns}|${key}`) ?? null,
      set: async (ns, key, value) => {
        store.set(`${ns}|${key}`, value);
      },
      delete: async (ns, key) => store.delete(`${ns}|${key}`),
      list: async (ns) => [...store.keys()].filter((k) => k.startsWith(`${ns}|`)).map((k) => k.split('|')[1]),
    };
    const providers = createSecureStoreProviders({ backend: memBackend, scope: 'user', ttlMs: 1000 });
    const accessorProvider = providers.find((p) => 'provide' in p && p.provide === SECURE_STORE_ACCESSOR) as {
      useFactory: (ctx: FrontMcpContext, logger: { child: () => unknown }) => SecureStoreAccessor;
    };

    const ctx = ctxWith({ sessionId: 'sess-x', authInfo: { extra: { user: { sub: 'user-9' } } } as never });
    const logger = { child: () => ({ warn() {}, debug() {} }) };
    const accessor = accessorProvider.useFactory(ctx, logger as never);

    await accessor.set('k', 'v');
    expect(await accessor.get<string>('k')).toBe('v');
    // The value is keyed under the user namespace (hashed sub), proving wiring.
    expect([...store.keys()].length).toBe(1);
  });
});
