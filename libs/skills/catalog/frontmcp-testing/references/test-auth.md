---
name: test-auth
description: Test authenticated MCP servers with TestTokenFactory, MockOAuthServer, and role-based access
---

# Testing with Authentication

Real API references:

- `TestTokenFactory.createTestToken(opts)` — `libs/auth/src/testing/token-factory.ts:135` (plus `createAdminToken`, `createUserToken`, `createAnonymousToken`, `createExpiredToken`, `createTokenWithInvalidSignature`).
- `new MockOAuthServer(tokenFactory, options)` + `.start()` / `.stop()` — `libs/auth/src/testing/mock-oauth-server.ts:175`.
- `TestServer.start({ command, port })` — `libs/testing/src/server/test-server.ts:101`. Get a client with `McpTestClient.create({ baseUrl }).withToken(token).buildAndConnect()`.
- Roles, email, and other claims go inside `claims`, not as top-level fields. `CreateTokenOptions` only declares `sub`, `iss`, `aud`, `scopes`, `exp`, `claims`.

```typescript
// auth.e2e.spec.ts
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('Authenticated Server', () => {
  let server: TestServer;
  let tokenFactory: TestTokenFactory;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3010,
    });
    tokenFactory = new TestTokenFactory({
      issuer: 'https://test-idp.example.com',
      audience: 'my-api',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('rejects unauthenticated requests', async () => {
    const client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .withPublicMode() // do not request an anonymous token; with no token given, send no Authorization header
      .buildAndConnect();

    const result = await client.tools.call('protected_tool', {});
    expect(result).toBeError();

    await client.disconnect();
  });

  it('accepts a valid token', async () => {
    const token = await tokenFactory.createTestToken({
      sub: 'user-123',
      scopes: ['read', 'write'],
    });

    const client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .withToken(token)
      .buildAndConnect();

    const result = await client.tools.call('protected_tool', { data: 'test' });
    expect(result).toBeSuccessful();

    await client.disconnect();
  });

  it('enforces role-based access', async () => {
    const adminToken = await tokenFactory.createTestToken({
      sub: 'admin-1',
      claims: { roles: ['admin'] },
    });
    const userToken = await tokenFactory.createTestToken({
      sub: 'user-1',
      claims: { roles: ['user'] },
    });

    const adminClient = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .withToken(adminToken)
      .buildAndConnect();
    const adminResult = await adminClient.tools.call('admin_only_tool', {});
    expect(adminResult).toBeSuccessful();

    const userClient = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .withToken(userToken)
      .buildAndConnect();
    const userResult = await userClient.tools.call('admin_only_tool', {});
    expect(userResult).toBeError();

    await adminClient.disconnect();
    await userClient.disconnect();
  });
});
```

## Token semantics

- Default issuer `https://test.frontmcp.local`, default audience `frontmcp-test` (override with `new TestTokenFactory({ issuer, audience })`).
- `expiresIn` is counted from now and rounded up to whole seconds, so `expiresIn: 1` is valid for at least one second. `createAnonymousToken(expiresIn?)` takes a lifetime too.
- `await mcp.authenticate(token)` opens a new session for the token and **rejects** if the server refuses it (expired, bad signature); the client then keeps its previous identity. On an unconnected client it only stores the token. 401/403 are never retried.
- Tools read token scopes through `this.auth` (e.g. `this.auth.scopes`).
- Access tokens from `MockOAuthServer` carry the granted `scope` claim and `exp = accessTokenTtlSeconds`, also after a refresh.

## Mock OAuth / OIDC server

`MockOAuthServer` serves JWKS, OAuth metadata, authorization, token, and userinfo endpoints. Construct it with a `TestTokenFactory`, call `.start()` to bind a port, and configure your MCP server to point at the returned `info.issuer` / `info.jwksUrl`.

```typescript
// mock-oauth.e2e.spec.ts
import { MockOAuthServer, TestTokenFactory } from '@frontmcp/testing';

describe('Mock OAuth server', () => {
  let tokenFactory: TestTokenFactory;
  let mockOAuth: MockOAuthServer;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory();
    mockOAuth = new MockOAuthServer(tokenFactory, {
      autoApprove: true,
      testUser: { sub: 'user-123', email: 'test@example.com' },
      clientId: 'test-client',
      validRedirectUris: ['http://localhost:3001/callback'],
    });
    await mockOAuth.start();
  });

  afterAll(async () => {
    await mockOAuth.stop();
  });

  it('exposes JWKS that verifies factory-issued tokens', async () => {
    const jwks = await fetch(mockOAuth.info.jwksUrl).then((r) => r.json());
    expect(jwks.keys.length).toBeGreaterThan(0);
  });

  it('issues tokens via the same factory', async () => {
    const token = await tokenFactory.createTestToken({ sub: 'user-123' });
    expect(token.split('.')).toHaveLength(3);
  });
});
```

To run the full authorization-code-with-PKCE flow against the mock server, drive the standard OAuth endpoints (`/oauth/authorize`, `/oauth/token`) directly with `fetch` — the mock server auto-approves when `autoApprove: true` and `testUser` are set. Send an S256 `code_challenge` and its `code_verifier` (`generatePkcePair()` from `@frontmcp/utils`): the mock requires them by default.

- **PKCE:** the mock checks PKCE as an OAuth 2.1 server does (`pkce: 'strict'`, the default since 1.14). An authorization request (or the manual sign-in form) without a `code_challenge`, with `code_challenge_method=plain`, or with no method (which means plain) is redirected back with `error=invalid_request` and an `error_description` that starts `S256 PKCE is required`. A `code_verifier` must be 43-128 unreserved characters. The metadata lists `code_challenge_methods_supported: ['S256']`. `pkce: 'lenient'` accepts those requests, as the mock did by default up to 1.13, and still checks a challenge it was given.
- **`auth_time`:** access and ID tokens from the code flow carry `auth_time`, the second the test user signed in. A refresh keeps it while `iat` moves on.
- **Resource indicators:** by default (`resourceIndicators: true`, since 1.14) the access token is issued with `aud` set to the `resource` (RFC 8707) and `audience` values of the authorization request: one value is a string, several are an array. A token request may name a subset of them to narrow the audience. Any other value is refused with `invalid_target`, and a refresh keeps the audience. A list (`resourceIndicators: ['https://mcp.example.com/mcp']`) also refuses every value outside it: the authorization request is redirected back with `error=invalid_target`. A request naming none gets the token factory's audience. `resourceIndicators: false` ignores `resource` and `audience`, so every token gets the token factory's audience, as up to 1.13.
- **Several users:** `users: [{ sub, email, name, claims, scopes }, ...]` lists who can sign in. The authorization request's `login_hint` (a `sub` or `email`) picks one, and an unknown hint is redirected back with `access_denied`. Without a hint, `testUser` signs in (`setTestUser()` changes it per test), else the first user. The manual sign-in form signs in the listed user whose `sub` is typed, prefilled with the hinted one. A user's `scopes` limit the granted scopes to those requested that the user has. `/userinfo` answers with the user the token names. Without `users`, `login_hint` is ignored and `testUser` signs in, as before.
- **Lighter import:** `MockOAuthServer` and `TestTokenFactory` are also exported by `@frontmcp/auth/testing`, the same classes, for a project that needs only a mock identity provider. That subpath depends on `jose` and `@frontmcp/utils` only, so it brings no SWC, Jest preset or SDK.

```typescript
import { MockOAuthServer, TestTokenFactory } from '@frontmcp/auth/testing';

const idp = new MockOAuthServer(new TestTokenFactory(), {
  autoApprove: true,
  users: [
    { sub: 'ada', email: 'ada@example.com', claims: { roles: ['admin'] } },
    { sub: 'bob', email: 'bob@example.com', scopes: ['openid', 'notes:read'] },
  ],
  clientId: 'my-cli',
  validRedirectUris: ['http://127.0.0.1:*/callback'],
  resourceIndicators: ['https://notes.example.com/mcp'],
});
// /oauth/authorize?...&code_challenge=<S256 challenge>&code_challenge_method=S256&login_hint=bob&resource=https://notes.example.com/mcp
//   -> an access token with sub 'bob', aud 'https://notes.example.com/mcp', auth_time
```

## Mock CIMD server

For end-to-end testing of **CIMD** (Client ID Metadata Documents — `client_id` is an
HTTPS URL the server fetches), use `MockCimdServer` from `@frontmcp/testing`. It serves
hosted client-metadata documents on a real port so your server's CIMD resolution +
`redirect_uri` validation run against a live document:

```typescript
import { MockCimdServer } from '@frontmcp/testing';

const cimdServer = new MockCimdServer();
const info = await cimdServer.start();

// Register a client; the returned client_id is the metadata-document URL.
const clientId = cimdServer.registerClient({
  name: 'Test Client',
  redirectUris: ['http://localhost:3000/callback'],
});

// Pass clientId as the OAuth client_id in your /oauth/authorize requests.
// …
await cimdServer.stop();
```

A client that authenticates with `private_key_jwt` lists its public keys with `jwks` (inline) or `jwksUri`, and signs
a client assertion for every `/oauth/token` request (`client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
`client_assertion=<JWT>` with `iss` and `sub` = the `client_id`, `aud` = the token endpoint, `exp` and a fresh `jti`):

```typescript
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('ES256');
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
const clientId = cimdServer.registerClient({
  name: 'Signed Client',
  tokenEndpointAuthMethod: 'private_key_jwt',
  jwks: { keys: [publicJwk] },
});

const clientAssertion = await new SignJWT({ jti: crypto.randomUUID() })
  .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
  .setIssuer(clientId)
  .setSubject(clientId)
  .setAudience(`${baseUrl}/oauth/token`)
  .setIssuedAt()
  .setExpirationTime('2m')
  .sign(privateKey);
```

## Upgrading to 1.14

- **`MockOAuthServer` checks PKCE strictly by default.** An authorization request without an S256 `code_challenge` is redirected back with `error=invalid_request`, where up to 1.13 the mock accepted it (1.13.2 also warned once). Send one (`generatePkcePair()` from `@frontmcp/utils`) and its `code_verifier` at the token endpoint, or set `pkce: 'lenient'` on a mock whose test isn't about PKCE. FrontMCP's own federated and remote sign-ins, `signInNative` and `frontmcp login` already send S256.
- **`MockOAuthServer` honours resource indicators by default.** The `resource` (RFC 8707) and `audience` values of the authorization request become the access token's `aud`, where up to 1.13 they were ignored (1.13.2 warned once) and every token got the token factory's audience. A token request can only narrow the values the authorization request named: one it didn't name is refused with `invalid_target`. When the authorization request named none, the token request may name them instead. A server that checks the audience then needs to expect that value; set `resourceIndicators: false` to keep the factory's audience. A sign-in that names none at either endpoint still gets the factory's audience.
- `pkce: 'strict'` and `resourceIndicators: true` are now the defaults, so a mock that set them can drop them. Neither default warns any more.

## Examples

| Example                                                                     | Level        | Description                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`oauth-flow-test`](../examples/test-auth/oauth-flow-test.md)               | Advanced     | Use `MockOAuthServer` to simulate an OAuth/OIDC identity provider. The server publishes a JWKS endpoint backed by your `TestTokenFactory`, so any token created by that factory is valid against the mock IDP. |
| [`role-based-access-test`](../examples/test-auth/role-based-access-test.md) | Intermediate | Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints.                                                                                                      |
| [`token-factory-test`](../examples/test-auth/token-factory-test.md)         | Basic        | Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.                                                                                                                 |

> See all examples in [`examples/test-auth/`](../examples/test-auth/)
