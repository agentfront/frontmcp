---
name: test-auth
description: Test authenticated MCP servers with TestTokenFactory, MockOAuthServer, and role-based access
---

# Testing with Authentication

Real API references:

- `TestTokenFactory.createTestToken(opts)` — `libs/testing/src/auth/token-factory.ts:97` (plus `createAdminToken`, `createUserToken`, `createAnonymousToken`, `createExpiredToken`, `createTokenWithInvalidSignature`).
- `new MockOAuthServer(tokenFactory, options)` + `.start()` / `.stop()` — `libs/testing/src/auth/mock-oauth-server.ts:159`.
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
      .withPublicMode() // do not request an anonymous token; send no Authorization header
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

To run the full authorization-code-with-PKCE flow against the mock server, drive the standard OAuth endpoints (`/oauth/authorize`, `/oauth/token`) directly with `fetch` — the mock server auto-approves when `autoApprove: true` and `testUser` are set.

## Examples

| Example                                                                     | Level        | Description                                                                                               |
| --------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| [`oauth-flow-test`](../examples/test-auth/oauth-flow-test.md)               | Advanced     | Use `MockOAuthServer` to simulate an OAuth identity provider and verify JWKS / token issuance.            |
| [`role-based-access-test`](../examples/test-auth/role-based-access-test.md) | Intermediate | Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints. |
| [`token-factory-test`](../examples/test-auth/token-factory-test.md)         | Basic        | Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.            |

> See all examples in [`examples/test-auth/`](../examples/test-auth/)
