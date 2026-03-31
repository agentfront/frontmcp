---
name: oauth-flow-test
reference: test-auth
level: advanced
description: 'Use `MockOAuthServer` to simulate an OAuth identity provider and test the authorization code flow.'
tags: [testing, oauth, auth, flow]
features:
  - 'Setting up `MockOAuthServer` with a mock issuer URL and port'
  - 'Starting an OAuth flow with `startFlow()` specifying client ID, redirect URI, and scopes'
  - 'Verifying the authorization URL contains an authorization code'
  - 'Testing concurrent OAuth flows with different client configurations'
  - 'Proper cleanup with `mockOAuth.close()` in `afterAll`'
---

# Testing OAuth Authorization Code Flow

Use `MockOAuthServer` to simulate an OAuth identity provider and test the authorization code flow.

## Code

```typescript
// src/__tests__/oauth-flow.e2e.spec.ts
import { MockOAuthServer } from '@frontmcp/testing';

describe('OAuth Flow', () => {
  let mockOAuth: MockOAuthServer;

  beforeAll(async () => {
    mockOAuth = await MockOAuthServer.create({
      issuer: 'https://test-idp.example.com',
      port: 9999,
    });
  });

  afterAll(async () => {
    await mockOAuth.close();
  });

  it('should complete OAuth authorization code flow', async () => {
    const { authorizationUrl } = await mockOAuth.startFlow({
      clientId: 'test-client',
      redirectUri: 'http://localhost:3001/callback',
      scopes: ['openid', 'profile'],
    });
    expect(authorizationUrl).toContain('code=');
  });

  it('should support multiple concurrent flows', async () => {
    const flow1 = await mockOAuth.startFlow({
      clientId: 'client-a',
      redirectUri: 'http://localhost:3001/callback',
      scopes: ['openid'],
    });

    const flow2 = await mockOAuth.startFlow({
      clientId: 'client-b',
      redirectUri: 'http://localhost:3002/callback',
      scopes: ['openid', 'email'],
    });

    expect(flow1.authorizationUrl).toContain('code=');
    expect(flow2.authorizationUrl).toContain('code=');
    expect(flow1.authorizationUrl).not.toBe(flow2.authorizationUrl);
  });
});
```

## What This Demonstrates

- Setting up `MockOAuthServer` with a mock issuer URL and port
- Starting an OAuth flow with `startFlow()` specifying client ID, redirect URI, and scopes
- Verifying the authorization URL contains an authorization code
- Testing concurrent OAuth flows with different client configurations
- Proper cleanup with `mockOAuth.close()` in `afterAll`

## Related

- See `test-auth` for the full authentication testing reference
