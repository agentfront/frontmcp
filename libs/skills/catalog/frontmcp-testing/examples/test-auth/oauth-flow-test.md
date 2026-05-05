---
name: oauth-flow-test
reference: test-auth
level: advanced
description: Use `MockOAuthServer` to simulate an OAuth/OIDC identity provider. The server publishes a JWKS endpoint backed by your `TestTokenFactory`, so any token created by that factory is valid against the mock IDP.
tags:
  - testing
  - oauth
  - auth
  - flow
features:
  - Constructing `MockOAuthServer` with a `TestTokenFactory` and starting it with `.start()`
  - Reading server info from `mockOAuth.info.baseUrl` / `mockOAuth.info.jwksUrl` after start
  - Issuing tokens via the same `TestTokenFactory` so the mock JWKS can verify them
  - Cleaning up with `mockOAuth.stop()` in `afterAll`
---

# Testing with the Mock OAuth Server

Use `MockOAuthServer` to simulate an OAuth/OIDC identity provider. The server publishes a JWKS endpoint backed by your `TestTokenFactory`, so any token created by that factory is valid against the mock IDP.

## Code

```typescript
// src/__tests__/oauth-flow.e2e.spec.ts
// Real API:
//   libs/testing/src/auth/mock-oauth-server.ts:159 — `new MockOAuthServer(tokenFactory, options)` + `.start()` / `.stop()`
//   libs/testing/src/auth/token-factory.ts:97 — `TestTokenFactory.createTestToken(opts)`
import { MockOAuthServer, TestTokenFactory } from '@frontmcp/testing';

describe('Mock OAuth Server', () => {
  let tokenFactory: TestTokenFactory;
  let mockOAuth: MockOAuthServer;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({
      issuer: 'https://test-idp.example.com',
      audience: 'my-api',
    });

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

  it('exposes a JWKS endpoint with at least one key', async () => {
    const res = await fetch(mockOAuth.info.jwksUrl);
    const jwks = (await res.json()) as { keys: Array<{ kid: string }> };

    expect(res.status).toBe(200);
    expect(jwks.keys.length).toBeGreaterThan(0);
  });

  it('issues tokens via the same factory the mock server trusts', async () => {
    const token = await tokenFactory.createTestToken({
      sub: 'user-123',
      scopes: ['openid', 'profile'],
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('reports server info after start', () => {
    expect(mockOAuth.info.baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
    expect(mockOAuth.info.jwksUrl).toBe(`${mockOAuth.info.baseUrl}/.well-known/jwks.json`);
  });
});
```

## What This Demonstrates

- Constructing `MockOAuthServer` with a `TestTokenFactory` and starting it with `.start()`
- Reading server info from `mockOAuth.info.baseUrl` / `mockOAuth.info.jwksUrl` after start
- Issuing tokens via the same `TestTokenFactory` so the mock JWKS can verify them
- Cleaning up with `mockOAuth.stop()` in `afterAll`

## Related

- See `test-auth` for the full authentication testing reference
