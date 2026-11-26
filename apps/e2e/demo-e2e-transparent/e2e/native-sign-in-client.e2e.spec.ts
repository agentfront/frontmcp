/**
 * `signInNative` and `getNativeTokens` over real HTTP: a small authorization server on a loopback port, and the
 * loopback redirect listener the test reaches by following the authorization endpoint's redirect, as a browser would.
 */
import {
  getNativeTokens,
  memoryTokenStore,
  NativeSignInError,
  signInNative,
  signOutNative,
  type NativeSignInOptions,
  type NativeTokenStore,
} from '@frontmcp/auth/native';
import { sha256Base64url } from '@frontmcp/utils';

import {
  followRedirect,
  startTestAuthorizationServer,
  type TestAuthorizationServer,
} from './helpers/test-authorization-server';

/** The sign-in's rejection, which must be a NativeSignInError. */
async function rejection(attempt: Promise<unknown>): Promise<NativeSignInError> {
  const error = await attempt.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(NativeSignInError);
  return error as NativeSignInError;
}

describe('signInNative', () => {
  let as: TestAuthorizationServer;
  let store: NativeTokenStore;
  let pages: Response[];

  const options = (overrides: Partial<NativeSignInOptions> = {}): NativeSignInOptions => ({
    issuer: as.issuer,
    clientId: 'notes-cli',
    scopes: ['openid', 'notes:read'],
    resource: 'https://notes.example.com/mcp',
    store,
    openBrowser: async (url) => void pages.push(await followRedirect(url)),
    ...overrides,
  });

  const requestsTo = (path: string) => as.requests.filter((request) => request.path === path);

  beforeEach(async () => {
    as = await startTestAuthorizationServer();
    store = memoryTokenStore();
    pages = [];
  });

  afterEach(async () => {
    await as?.close();
  });

  it('signs in through discovery, S256 PKCE and a loopback redirect, and keeps the tokens', async () => {
    const tokens = await signInNative(options());

    expect(tokens).toMatchObject({
      accessToken: expect.stringMatching(/^access-/),
      refreshToken: expect.stringMatching(/^refresh-/),
      tokenType: 'Bearer',
      scope: 'notes:read',
      issuer: as.issuer,
      tokenEndpoint: `${as.issuer}/token`,
      clientId: 'notes-cli',
      resource: ['https://notes.example.com/mcp'],
    });
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(pages[0].status).toBe(200);
    expect(await pages[0].text()).toContain('Signed in');

    const [authorize] = requestsTo('/authorize');
    expect(authorize.params.get('code_challenge_method')).toBe('S256');
    expect(authorize.params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(authorize.params.get('scope')).toBe('openid notes:read');
    expect(authorize.params.getAll('resource')).toEqual(['https://notes.example.com/mcp']);
    expect(authorize.params.get('state')).toHaveLength(43);

    const [token] = requestsTo('/token');
    expect(sha256Base64url(token.params.get('code_verifier') as string)).toBe(authorize.params.get('code_challenge'));
    expect(token.params.get('client_id')).toBe('notes-cli');
    expect(token.params.getAll('resource')).toEqual(['https://notes.example.com/mcp']);

    expect(await store.get(`${as.issuer} notes-cli https://notes.example.com/mcp`)).toEqual(tokens);
  });

  it('sends the audience on the authorization request', async () => {
    await signInNative(options({ audience: 'notes-api' }));

    expect(requestsTo('/authorize')[0].params.get('audience')).toBe('notes-api');
  });

  it('refuses a response whose state is not the one it sent', async () => {
    as.redirectExtras = { state: 'forged' };

    expect((await rejection(signInNative(options()))).code).toBe('state_mismatch');
    expect(pages[0].status).toBe(400);
    expect(requestsTo('/token')).toHaveLength(0);
  });

  it('reports the error the authorization server redirected with', async () => {
    as.redirectExtras = { error: 'access_denied', error_description: 'The user said no' };

    expect(await rejection(signInNative(options()))).toMatchObject({
      code: 'access_denied',
      message: 'access_denied: The user said no',
    });
  });

  it('refuses a response from another issuer (RFC 9207)', async () => {
    as.redirectExtras = { iss: 'https://evil.example.com' };

    expect((await rejection(signInNative(options()))).code).toBe('issuer_mismatch');
  });

  it('requires iss when the server promises it', async () => {
    as.metadata['authorization_response_iss_parameter_supported'] = true;
    expect((await rejection(signInNative(options()))).code).toBe('issuer_mismatch');

    as.redirectExtras = { iss: as.issuer };
    await expect(signInNative(options())).resolves.toMatchObject({ issuer: as.issuer });
  });

  it('stops waiting after timeoutMs and frees the port', async () => {
    let redirectUri = '';
    const openBrowser = (url: string) => void (redirectUri = new URL(url).searchParams.get('redirect_uri') as string);

    expect((await rejection(signInNative(options({ timeoutMs: 50, openBrowser })))).code).toBe('timeout');
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it('closes the redirect listener when the browser cannot be opened', async () => {
    let redirectUri = '';
    const openBrowser = async (url: string) => {
      redirectUri = new URL(url).searchParams.get('redirect_uri') as string;
      throw new Error('no browser');
    };

    await expect(signInNative(options({ openBrowser }))).rejects.toThrow('no browser');
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it('refuses metadata that names another issuer', async () => {
    as.metadata['issuer'] = 'https://other.example.com';

    expect((await rejection(signInNative(options()))).code).toBe('discovery_failed');
  });

  it('refuses a server that does not list S256', async () => {
    as.metadata['code_challenge_methods_supported'] = ['plain'];

    expect((await rejection(signInNative(options()))).code).toBe('discovery_failed');
  });

  it('refuses endpoints that are not https or loopback', async () => {
    expect((await rejection(signInNative(options({ issuer: 'http://auth.example.com' })))).code).toBe('insecure_url');

    as.metadata['token_endpoint'] = 'http://auth.example.com/token';
    expect((await rejection(signInNative(options()))).code).toBe('insecure_url');
  });

  it('reports the token endpoint error', async () => {
    as.metadata['token_endpoint'] = `${as.issuer}/missing`;

    expect((await rejection(signInNative(options()))).code).toBe('not_found');
  });
});

describe('getNativeTokens', () => {
  let as: TestAuthorizationServer;
  let store: NativeTokenStore;

  const options = (): NativeSignInOptions => ({
    issuer: as.issuer,
    clientId: 'notes-cli',
    store,
    openBrowser: async (url) => void (await followRedirect(url)),
  });
  const tokenRequests = () => as.requests.filter((request) => request.path === '/token');

  beforeEach(async () => {
    as = await startTestAuthorizationServer();
    store = memoryTokenStore();
  });

  afterEach(async () => {
    await as?.close();
  });

  it('is undefined before sign-in and after sign-out', async () => {
    expect(await getNativeTokens(options())).toBeUndefined();
    await signInNative(options());
    expect(await getNativeTokens(options())).toBeDefined();
    await signOutNative(options());
    expect(await getNativeTokens(options())).toBeUndefined();
  });

  it('returns fresh tokens without a request', async () => {
    const tokens = await signInNative(options());

    expect(await getNativeTokens(options())).toEqual(tokens);
    expect(tokenRequests()).toHaveLength(1);
  });

  it('refreshes tokens about to expire, once for concurrent callers, and keeps the new ones', async () => {
    as.expiresIn = 30;
    const first = await signInNative(options());
    as.expiresIn = 3600;

    const [a, b] = await Promise.all([getNativeTokens(options()), getNativeTokens(options())]);

    expect(a).toEqual(b);
    expect(a?.accessToken).not.toBe(first.accessToken);
    expect(a?.refreshToken).not.toBe(first.refreshToken);
    const refreshes = tokenRequests().filter((request) => request.params.get('grant_type') === 'refresh_token');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].params.get('refresh_token')).toBe(first.refreshToken);
    expect(refreshes[0].params.get('client_id')).toBe('notes-cli');
    expect(await getNativeTokens(options())).toEqual(a);
  });

  it('drops the tokens when the server refuses the refresh token', async () => {
    as.expiresIn = 30;
    await signInNative(options());
    as.refreshTokens.clear();

    expect(await getNativeTokens(options())).toBeUndefined();
    expect(await store.get(`${as.issuer} notes-cli`)).toBeUndefined();
    expect(tokenRequests()).toHaveLength(2);
  });

  it('is undefined for expired tokens without a refresh token', async () => {
    await store.set(`${as.issuer} notes-cli`, {
      accessToken: 'old',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1000,
      issuer: as.issuer,
      tokenEndpoint: `${as.issuer}/token`,
      clientId: 'notes-cli',
    });

    expect(await getNativeTokens(options())).toBeUndefined();
  });
});
