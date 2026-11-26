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
  type NativeTokenSet,
} from '..';

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
