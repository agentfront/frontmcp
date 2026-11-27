/**
 * Unit tests of native sign-in. The flows over real HTTP, against a small authorization server on a loopback port,
 * are in apps/e2e/demo-e2e-transparent/e2e/native-sign-in-client.e2e.spec.ts.
 */
import {
  authorizationServerMetadataUrls,
  discoverAuthorizationServer,
  getNativeTokens,
  memoryTokenStore,
  NativeSignInError,
  signInNative,
  signOutNative,
  type NativeTokenOptions,
  type NativeTokenSet,
  type NativeTokenStore,
} from '..';
import { listenForRedirect } from '../loopback-redirect';

// The browser half is the loopback listener's own spec: here the callback comes back at once with a code.
jest.mock('../loopback-redirect', () => ({
  listenForRedirect: jest.fn(async () => ({
    redirectUri: 'http://127.0.0.1:5555/callback',
    code: Promise.resolve('the-code'),
    close: jest.fn(),
  })),
}));

const ISSUER = 'https://auth.example.com/tenant';
const RFC8414_URL = 'https://auth.example.com/.well-known/oauth-authorization-server/tenant';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Answers each URL with its document, and every other with 404. */
function serve(documents: Record<string, unknown>): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url in documents ? json(documents[url]) : json({ error: 'not_found' }, 404);
  });
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    code_challenge_methods_supported: ['S256'],
    ...overrides,
  };
}

async function rejection(attempt: Promise<unknown>): Promise<NativeSignInError> {
  const error = await attempt.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(NativeSignInError);
  return error as NativeSignInError;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('authorizationServerMetadataUrls', () => {
  it('tries the RFC 8414 document, then the OpenID one', () => {
    expect(authorizationServerMetadataUrls('https://auth.example.com/')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
  });

  it('inserts an issuer path after the well-known segment, then appends it the OpenID way', () => {
    expect(authorizationServerMetadataUrls('https://auth.example.com/tenants/acme')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenants/acme',
      'https://auth.example.com/.well-known/openid-configuration/tenants/acme',
      'https://auth.example.com/tenants/acme/.well-known/openid-configuration',
    ]);
  });
});

describe('discoverAuthorizationServer', () => {
  it('takes the document whose issuer is the issuer, as written', async () => {
    serve({ [RFC8414_URL]: metadata() });

    await expect(discoverAuthorizationServer(ISSUER)).resolves.toMatchObject({ token_endpoint: `${ISSUER}/token` });
  });

  it.each([
    ['a trailing slash the issuer lacks', ISSUER, `${ISSUER}/`],
    ['no trailing slash where the issuer has one', 'https://auth.example.com/', 'https://auth.example.com'],
  ])('refuses a document whose issuer differs by %s (RFC 8414 §3.3)', async (_case, issuer, named) => {
    const documents: Record<string, unknown> = {};
    for (const url of authorizationServerMetadataUrls(issuer)) documents[url] = metadata({ issuer: named });
    serve(documents);

    expect((await rejection(discoverAuthorizationServer(issuer))).code).toBe('discovery_failed');
  });

  it.each([
    ['authorization_response_iss_parameter_supported', 'true'],
    ['authorization_response_iss_parameter_supported', null],
    ['code_challenge_methods_supported', 'plain'],
    ['code_challenge_methods_supported', ['S256', 7]],
  ])('refuses a document whose %s is %p, not the type RFC 8414 gives it', async (field, value) => {
    serve({ [RFC8414_URL]: metadata({ [field]: value }) });

    const error = await rejection(discoverAuthorizationServer(ISSUER));

    expect(error.code).toBe('discovery_failed');
    expect(error.message).toContain(field);
  });

  it.each(['authorization_endpoint', 'token_endpoint'])(
    'refuses an http loopback %s of an https issuer, whose credentials would go unencrypted',
    async (field) => {
      serve({ [RFC8414_URL]: metadata({ [field]: 'http://127.0.0.1:8080/oauth' }) });

      expect((await rejection(discoverAuthorizationServer(ISSUER))).code).toBe('insecure_url');
    },
  );

  it('takes http loopback endpoints from an http loopback issuer, a local development server', async () => {
    const local = 'http://127.0.0.1:8080';
    serve({
      [`${local}/.well-known/oauth-authorization-server`]: metadata({
        issuer: local,
        authorization_endpoint: `${local}/authorize`,
        token_endpoint: `http://localhost:8080/token`,
      }),
    });

    await expect(discoverAuthorizationServer(local)).resolves.toMatchObject({ issuer: local });
  });
});

describe('getNativeTokens refresh endpoint', () => {
  it('refuses to send a refresh token over http for an https issuer', async () => {
    const fetchSpy = serve({});
    const store = memoryTokenStore();
    const tokens: NativeTokenSet = {
      accessToken: 'old',
      tokenType: 'Bearer',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000,
      issuer: ISSUER,
      tokenEndpoint: 'http://127.0.0.1:8080/token',
      clientId: 'notes-cli',
    };
    await store.set(`${ISSUER} notes-cli`, tokens);

    expect((await rejection(getNativeTokens({ issuer: ISSUER, clientId: 'notes-cli', store }))).code).toBe(
      'insecure_url',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

/** Lets the code under test run its next steps, which a held request then waits behind. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * An authorization server behind `fetch`: its metadata, and a token endpoint that rotates refresh tokens, so a
 * refresh token works once. `holdNextRefresh` keeps the next refresh's answer until released.
 */
function fakeIdp() {
  let counter = 0;
  let held: Promise<void> | undefined;
  const idp = {
    tokenRequests: [] as URLSearchParams[],
    refreshTokens: new Set<string>(),
    codeExchanged: deferred(),
    refreshRequests: () => idp.tokenRequests.filter((params) => params.get('grant_type') === 'refresh_token'),
    holdNextRefresh() {
      const arrived = deferred();
      const release = deferred();
      held = release.promise;
      const onArrival = arrived.resolve;
      idp.onRefresh = () => {
        idp.onRefresh = undefined;
        onArrival();
      };
      return { arrived: arrived.promise, release: release.resolve };
    },
    onRefresh: undefined as (() => void) | undefined,
  };
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === RFC8414_URL) return json(metadata());
    if (url !== `${ISSUER}/token`) return json({ error: 'not_found' }, 404);
    const params = new URLSearchParams(String(init?.body));
    idp.tokenRequests.push(params);
    if (params.get('grant_type') === 'refresh_token') {
      idp.onRefresh?.();
      const wait = held;
      held = undefined;
      await wait;
      if (!idp.refreshTokens.delete(params.get('refresh_token') ?? '')) return json({ error: 'invalid_grant' }, 400);
    } else {
      idp.codeExchanged.resolve();
    }
    const refreshToken = `refresh-${++counter}`;
    idp.refreshTokens.add(refreshToken);
    return json({
      access_token: `access-${counter}`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
    });
  });
  return idp;
}

/** A store in memory whose `stallGet(n)` holds the n-th read, with what was stored when it was made, until released. */
function testStore() {
  const entries = new Map<string, NativeTokenSet>();
  let gets = 0;
  let stalled: { at: number; until: Promise<void> } | undefined;
  let failSets = 0;
  let failDeletes = 0;
  const store: NativeTokenStore = {
    async get(key) {
      const snapshot = entries.get(key);
      if (++gets === stalled?.at) await stalled.until;
      return snapshot;
    },
    async set(key, tokens) {
      if (failSets > 0) {
        failSets--;
        throw new Error('store down');
      }
      entries.set(key, tokens);
    },
    async delete(key) {
      if (failDeletes > 0) {
        failDeletes--;
        throw new Error('store down');
      }
      entries.delete(key);
    },
  };
  return {
    store,
    entries,
    stallGet(at: number) {
      const release = deferred();
      stalled = { at, until: release.promise };
      return release.resolve;
    },
    failNextSet: () => void failSets++,
    failNextDelete: () => void failDeletes++,
  };
}

const KEY = `${ISSUER} notes-cli`;

describe('getNativeTokens, signInNative and signOutNative on one store and key', () => {
  let idp: ReturnType<typeof fakeIdp>;
  let kept: ReturnType<typeof testStore>;
  let options: NativeTokenOptions;

  /** Tokens about to expire, with a refresh token the server takes once. */
  function expiring(): NativeTokenSet {
    idp.refreshTokens.add('refresh-0');
    return {
      accessToken: 'access-0',
      tokenType: 'Bearer',
      refreshToken: 'refresh-0',
      expiresAt: Date.now() + 30_000,
      issuer: ISSUER,
      tokenEndpoint: `${ISSUER}/token`,
      clientId: 'notes-cli',
    };
  }

  beforeEach(() => {
    idp = fakeIdp();
    kept = testStore();
    options = { issuer: ISSUER, clientId: 'notes-cli', store: kept.store };
  });

  it('shares one read and refresh between callers, even a caller whose read the store answers late', async () => {
    kept.entries.set(KEY, expiring());
    const releaseRead = kept.stallGet(2);

    const first = getNativeTokens(options);
    const second = getNativeTokens(options);
    const refreshed = await first;
    releaseRead();

    expect(await second).toEqual(refreshed);
    expect(refreshed?.refreshToken).toBe('refresh-1');
    expect(await getNativeTokens(options)).toEqual(refreshed);
    expect(idp.refreshRequests()).toHaveLength(1);
  });

  it('lets a sign-out during a refresh win: the refresh does not sign the caller back in', async () => {
    kept.entries.set(KEY, expiring());
    const refresh = idp.holdNextRefresh();

    const reading = getNativeTokens(options);
    await refresh.arrived;
    const signingOut = signOutNative(options);
    await settle();
    refresh.release();
    await Promise.all([reading, signingOut]);

    expect(kept.entries.get(KEY)).toBeUndefined();
    expect(await getNativeTokens(options)).toBeUndefined();
  });

  it.each([
    ['new tokens', false],
    ['invalid_grant', true],
  ])('keeps a newer sign-in when the refresh before it answers with %s', async (_answer, refused) => {
    kept.entries.set(KEY, expiring());
    const refresh = idp.holdNextRefresh();

    const reading = getNativeTokens(options);
    await refresh.arrived;
    if (refused) idp.refreshTokens.clear();
    const signingIn = signInNative({ ...options, openBrowser: () => undefined });
    await idp.codeExchanged.promise;
    await settle();
    refresh.release();
    const [, signedIn] = await Promise.all([reading, signingIn]);

    expect(kept.entries.get(KEY)?.accessToken).toBe(signedIn.accessToken);
    expect(await getNativeTokens(options)).toEqual(signedIn);
  });

  it('keeps refreshed tokens the store could not save, and saves them before it refreshes again', async () => {
    kept.entries.set(KEY, expiring());
    kept.failNextSet();

    await expect(getNativeTokens(options)).rejects.toThrow('store down');
    const next = await getNativeTokens(options);

    expect(next).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(kept.entries.get(KEY)).toEqual(next);
    expect(idp.refreshRequests()).toHaveLength(1);
  });

  it.each([
    ['a sign-in', 'set'],
    ['a sign-out', 'delete'],
  ])('keeps refreshed tokens the store could not save when %s cannot write either', async (_operation, write) => {
    kept.entries.set(KEY, expiring());
    kept.failNextSet();
    await expect(getNativeTokens(options)).rejects.toThrow('store down');

    if (write === 'set') {
      kept.failNextSet();
      await expect(signInNative({ ...options, openBrowser: () => undefined })).rejects.toThrow('store down');
    } else {
      kept.failNextDelete();
      await expect(signOutNative(options)).rejects.toThrow('store down');
    }

    // The store holds the refresh token the server spent; the refreshed tokens are still the ones to keep.
    expect(await getNativeTokens(options)).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(kept.entries.get(KEY)).toMatchObject({ refreshToken: 'refresh-1' });
  });

  it('drops refreshed tokens the store could not save once the caller signs out', async () => {
    kept.entries.set(KEY, expiring());
    kept.failNextSet();
    await expect(getNativeTokens(options)).rejects.toThrow('store down');

    await signOutNative(options);

    expect(await getNativeTokens(options)).toBeUndefined();
    expect(kept.entries.get(KEY)).toBeUndefined();
  });
});

describe('getNativeTokens without a refresh token', () => {
  it('returns the access token while it is still valid, then undefined once it expires', async () => {
    const idp = fakeIdp();
    const kept = testStore();
    const options = { issuer: ISSUER, clientId: 'notes-cli', store: kept.store };
    const tokens: NativeTokenSet = {
      accessToken: 'access-short',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 30_000,
      issuer: ISSUER,
      tokenEndpoint: `${ISSUER}/token`,
      clientId: 'notes-cli',
    };
    kept.entries.set(KEY, tokens);

    expect(await getNativeTokens(options)).toEqual(tokens);

    kept.entries.set(KEY, { ...tokens, expiresAt: Date.now() - 1 });
    expect(await getNativeTokens(options)).toBeUndefined();
    expect(idp.tokenRequests).toHaveLength(0);
  });
});

describe('the default store key', () => {
  it('keeps the tokens of two audiences apart, for sign-in, lookup and sign-out', async () => {
    fakeIdp();
    const kept = testStore();
    const base = { issuer: ISSUER, clientId: 'notes-cli', store: kept.store, openBrowser: () => undefined };
    const forNotes = { ...base, audience: 'notes-api' };
    const forTasks = { ...base, audience: 'tasks-api' };

    const notes = await signInNative(forNotes);
    const tasks = await signInNative(forTasks);

    expect(await getNativeTokens(forNotes)).toEqual(notes);
    expect(await getNativeTokens(forTasks)).toEqual(tasks);
    await signOutNative(forNotes);
    expect(await getNativeTokens(forNotes)).toBeUndefined();
    expect(await getNativeTokens(forTasks)).toEqual(tasks);
  });

  it('is unchanged without an audience, and an explicit storeKey still wins', async () => {
    fakeIdp();
    const kept = testStore();
    const base = { issuer: ISSUER, clientId: 'notes-cli', store: kept.store, openBrowser: () => undefined };

    const plain = await signInNative(base);
    const named = await signInNative({ ...base, audience: 'notes-api', storeKey: 'mine' });

    expect(kept.entries.get(KEY)).toEqual(plain);
    expect(kept.entries.get('mine')).toEqual(named);
    expect(kept.entries.get(`${KEY} audience=notes-api`)).toBeUndefined();
  });
});

describe('signInNative with a launcher that never settles', () => {
  const never = () => new Promise<void>(() => undefined);

  it('ends with the callback timeout', async () => {
    fakeIdp();
    const timedOut = new Promise<string>((_resolve, reject) =>
      setTimeout(() => reject(new NativeSignInError('timeout', 'No sign-in came back within 0s')), 20),
    );
    timedOut.catch(() => undefined);
    jest.mocked(listenForRedirect).mockResolvedValueOnce({
      redirectUri: 'http://127.0.0.1:5555/callback',
      code: timedOut,
      close: jest.fn(),
    });

    const error = await rejection(signInNative({ issuer: ISSUER, clientId: 'notes-cli', openBrowser: never }));

    expect(error.code).toBe('timeout');
  }, 2_000);

  it('signs in once the callback comes back', async () => {
    fakeIdp();
    const store = memoryTokenStore();

    const tokens = await signInNative({ issuer: ISSUER, clientId: 'notes-cli', store, openBrowser: never });

    expect(tokens.accessToken).toBe('access-1');
  }, 2_000);

  it('reports a launcher that fails before the callback comes back', async () => {
    fakeIdp();
    jest.mocked(listenForRedirect).mockResolvedValueOnce({
      redirectUri: 'http://127.0.0.1:5555/callback',
      code: new Promise<string>(() => undefined),
      close: jest.fn(),
    });

    await expect(
      signInNative({
        issuer: ISSUER,
        clientId: 'notes-cli',
        openBrowser: async () => {
          throw new Error('no browser');
        },
      }),
    ).rejects.toThrow('no browser');
  }, 2_000);
});
