/**
 * Credentials providers — resolveRequestSub + createCredentialsProviders
 * (Checkpoint 3b).
 *
 * Asserts the request-subject resolution (used by `this.credentials` to key the
 * vault) and the DI provider wiring (vault GLOBAL value + accessor CONTEXT
 * factory).
 */
import 'reflect-metadata';

import { CREDENTIALS_ACCESSOR, type SessionCredentialVault } from '@frontmcp/auth';

import type { FrontMcpContext } from '../../../context/frontmcp-context';
import { createCredentialsProviders, resolveRequestSub, SESSION_CREDENTIAL_VAULT } from '../credentials.providers';

function ctxWith(authInfo: unknown): FrontMcpContext {
  return { authInfo } as unknown as FrontMcpContext;
}

describe('resolveRequestSub', () => {
  it('returns the JWT sub from authInfo.extra.user.sub', () => {
    expect(resolveRequestSub(ctxWith({ extra: { user: { sub: 'user-42' } } }))).toBe('user-42');
  });

  it('returns undefined for an anonymous subject', () => {
    expect(resolveRequestSub(ctxWith({ extra: { user: { sub: 'anon:abc' } } }))).toBeUndefined();
  });

  it('returns undefined for an empty/missing subject', () => {
    expect(resolveRequestSub(ctxWith({ extra: { user: { sub: '' } } }))).toBeUndefined();
    expect(resolveRequestSub(ctxWith({ extra: { user: {} } }))).toBeUndefined();
    expect(resolveRequestSub(ctxWith({ extra: {} }))).toBeUndefined();
    expect(resolveRequestSub(ctxWith(undefined))).toBeUndefined();
  });

  it('returns undefined when sub is not a string', () => {
    expect(resolveRequestSub(ctxWith({ extra: { user: { sub: 123 } } }))).toBeUndefined();
  });
});

describe('createCredentialsProviders', () => {
  const vault = {} as SessionCredentialVault;

  it('wires a GLOBAL vault value provider and a CONTEXT accessor factory', () => {
    const providers = createCredentialsProviders({
      vault,
      signingSecret: 'secret',
      basePath: 'https://host/mcp',
    });
    expect(providers).toHaveLength(2);

    const vaultProvider = providers.find((p) => 'provide' in p && p.provide === SESSION_CREDENTIAL_VAULT) as Record<
      string,
      unknown
    >;
    expect(vaultProvider).toBeTruthy();
    expect(vaultProvider['useValue']).toBe(vault);
    expect(vaultProvider['scope']).toBe('global');

    const accessorProvider = providers.find((p) => 'provide' in p && p.provide === CREDENTIALS_ACCESSOR) as Record<
      string,
      unknown
    >;
    expect(accessorProvider).toBeTruthy();
    expect(typeof accessorProvider['useFactory']).toBe('function');
    expect(typeof accessorProvider['inject']).toBe('function');
    expect(accessorProvider['scope']).toBe('context');
  });
});
