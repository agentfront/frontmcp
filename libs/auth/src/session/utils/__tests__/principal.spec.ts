import { detectPrincipal, isAuthPrincipal, resolvePrincipal, type AuthPrincipal } from '../principal';

describe('detectPrincipal', () => {
  it('names a person: a subject that is not its client, with when they signed in', () => {
    expect(
      detectPrincipal({ sub: 'user-42', azp: 'desk-app', client_id: 'desk-app', auth_time: 1_700_000_000, iat: 1 }),
    ).toEqual({ kind: 'person', sub: 'user-42', clientId: 'desk-app', authTime: 1_700_000_000 });
  });

  it('falls back to iat for when the caller authenticated', () => {
    expect(detectPrincipal({ sub: 'user-42', iat: 1_800_000_000 })).toEqual({
      kind: 'person',
      sub: 'user-42',
      authTime: 1_800_000_000,
    });
  });

  it.each([
    ['Auth0 client credentials (gty)', { sub: 'svc@clients', gty: 'client-credentials', azp: 'svc' }],
    ['a client_credentials gty', { sub: 'svc', gty: 'client_credentials' }],
    ['a Microsoft Entra app token (idtyp)', { sub: 'service-principal-oid', idtyp: 'app', azp: 'app-id' }],
    ['RFC 9068: the subject is the client_id', { sub: 'billing-service', client_id: 'billing-service' }],
    ['the subject is the azp', { sub: 'billing-service', azp: 'billing-service' }],
    ['Okta: the subject is the cid', { sub: '0oa1b2c3', cid: '0oa1b2c3' }],
    ['Entra v1: the subject is the appid', { sub: 'app-guid', appid: 'app-guid' }],
    ['no sub: named by its client_id', { client_id: 'billing-service' }],
    ['no sub: named by its azp', { azp: 'billing-service' }],
  ])('names a machine: %s', (_label, claims) => {
    expect(detectPrincipal(claims).kind).toBe('machine');
  });

  it('reports the grant type a token names, client credentials normalized', () => {
    expect(detectPrincipal({ sub: 'svc@clients', gty: 'client-credentials' }).grantType).toBe('client_credentials');
    expect(detectPrincipal({ sub: 'user-42', gty: 'password' })).toEqual({
      kind: 'person',
      sub: 'user-42',
      grantType: 'password',
    });
  });

  it('names the client by client_id, else azp, else cid', () => {
    expect(detectPrincipal({ sub: 'u', client_id: 'a', azp: 'b', cid: 'c' }).clientId).toBe('a');
    expect(detectPrincipal({ sub: 'u', azp: 'b', cid: 'c' }).clientId).toBe('b');
    expect(detectPrincipal({ sub: 'u', cid: 'c' }).clientId).toBe('c');
  });

  it.each([{}, { sub: '' }, { sub: 'anon:3f2a' }])('names no one for %j', (claims) => {
    expect(detectPrincipal(claims).kind).toBe('anonymous');
  });

  it('ignores claims of the wrong type', () => {
    expect(detectPrincipal({ sub: 'user-42', client_id: 42, auth_time: '1700000000', gty: false })).toEqual({
      kind: 'person',
      sub: 'user-42',
    });
  });
});

describe('resolvePrincipal', () => {
  const keycloakServiceAccount = {
    sub: 'f81d4fae-7dec-11d0',
    azp: 'sync-service',
    preferred_username: 'service-account-sync-service',
  };

  it('is the detected principal without a resolver', async () => {
    expect(await resolvePrincipal(keycloakServiceAccount)).toEqual(detectPrincipal(keycloakServiceAccount));
  });

  it("takes the fields a resolver changes, sync or async, and keeps the detected ones it doesn't", async () => {
    const byUsername = (claims: Readonly<Record<string, unknown>>) =>
      String(claims['preferred_username']).startsWith('service-account-') ? { kind: 'machine' as const } : undefined;

    expect(await resolvePrincipal(keycloakServiceAccount, byUsername)).toEqual({
      kind: 'machine',
      sub: 'f81d4fae-7dec-11d0',
      clientId: 'sync-service',
    });
    expect(await resolvePrincipal({ sub: 'user-42' }, async () => ({ sub: 'hub:user-42' }))).toEqual({
      kind: 'person',
      sub: 'hub:user-42',
    });
    expect(await resolvePrincipal({ sub: 'user-42' }, () => undefined)).toEqual({ kind: 'person', sub: 'user-42' });
    expect(
      await resolvePrincipal({ sub: 'svc', iat: 5 }, () => ({ kind: 'machine', grantType: 'client_credentials' })),
    ).toEqual({ kind: 'machine', sub: 'svc', authTime: 5, grantType: 'client_credentials' });
  });

  it('gets the claims and the detected principal', async () => {
    const resolver = jest.fn(() => undefined);
    await resolvePrincipal({ sub: 'user-42' }, resolver);

    expect(resolver).toHaveBeenCalledWith({ sub: 'user-42' }, { kind: 'person', sub: 'user-42' });
  });

  it('keeps only the fields of a principal from what a resolver answers', async () => {
    const resolved = await resolvePrincipal({ sub: 'user-42' }, () => ({ kind: 'person', tenant: 'acme' }) as never);

    expect(resolved).toEqual({ kind: 'person', sub: 'user-42' });
  });

  it('keeps the detected principal, and reports why, when a resolver throws or answers an unknown kind', async () => {
    const reported: string[] = [];
    const onError = (message: string) => reported.push(message);

    const thrown = await resolvePrincipal(
      { sub: 'user-42' },
      () => {
        throw new Error('directory unreachable');
      },
      onError,
    );
    const unknownKind = await resolvePrincipal({ sub: 'user-42' }, () => ({ kind: 'robot' }) as never, onError);
    const badAuthTime = await resolvePrincipal({ sub: 'user-42' }, () => ({ authTime: 'yesterday' }) as never, onError);
    const badClient = await resolvePrincipal({ sub: 'user-42' }, () => ({ clientId: 7 }) as never, onError);

    expect([thrown, unknownKind, badAuthTime, badClient]).toEqual([
      { kind: 'person', sub: 'user-42' },
      { kind: 'person', sub: 'user-42' },
      { kind: 'person', sub: 'user-42' },
      { kind: 'person', sub: 'user-42' },
    ]);
    expect(reported).toEqual([
      'The principal resolver failed: directory unreachable',
      'The principal resolver answered a principal FrontMCP cannot use (kind "robot")',
      'The principal resolver answered a principal FrontMCP cannot use (authTime "yesterday")',
      'The principal resolver answered a principal FrontMCP cannot use (clientId 7)',
    ]);
  });
});

describe('isAuthPrincipal', () => {
  it('accepts a principal and refuses anything else', () => {
    const principal: AuthPrincipal = { kind: 'machine', sub: 'svc' };

    expect(
      [principal, { kind: 'person', sub: 1 }, { kind: 'robot', sub: 'x' }, null, 'person'].map(isAuthPrincipal),
    ).toEqual([true, false, false, false, false]);
  });

  it('checks every optional field that is present', () => {
    const full: AuthPrincipal = { kind: 'person', sub: 'u', clientId: 'c', authTime: 1, grantType: 'password' };

    expect(
      [
        full,
        { kind: 'person', sub: 'u', authTime: 'yesterday' },
        { kind: 'person', sub: 'u', authTime: Number.NaN },
        { kind: 'person', sub: 'u', clientId: 7 },
        { kind: 'person', sub: 'u', grantType: false },
      ].map(isAuthPrincipal),
    ).toEqual([true, false, false, false, false]);
  });
});
