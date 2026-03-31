---
name: token-factory-test
reference: test-auth
level: basic
description: 'Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.'
tags: [testing, auth, token, factory]
features:
  - 'Creating a `TestTokenFactory` with issuer and audience configuration'
  - 'Generating test tokens with specific subjects and scopes via `createToken()`'
  - 'Passing tokens to `server.connect({ authToken })` for authenticated client connections'
  - 'Verifying that unauthenticated requests are rejected with `isError`'
---

# Testing Authentication with TestTokenFactory

Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.

## Code

```typescript
// src/__tests__/auth.e2e.spec.ts
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';
import Server from '../src/main';

describe('Authenticated Server', () => {
  let server: TestServer;
  let tokenFactory: TestTokenFactory;

  beforeAll(async () => {
    server = await TestServer.create(Server);
    tokenFactory = new TestTokenFactory({
      issuer: 'https://test-idp.example.com',
      audience: 'my-api',
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('should reject unauthenticated requests', async () => {
    const client = await server.connect();
    const result = await client.callTool('protected_tool', {});
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('should accept valid token', async () => {
    const token = await tokenFactory.createToken({
      sub: 'user-123',
      scopes: ['read', 'write'],
    });

    const client = await server.connect({ authToken: token });
    const result = await client.callTool('protected_tool', { data: 'test' });
    expect(result).toBeSuccessful();
    await client.close();
  });
});
```

## What This Demonstrates

- Creating a `TestTokenFactory` with issuer and audience configuration
- Generating test tokens with specific subjects and scopes via `createToken()`
- Passing tokens to `server.connect({ authToken })` for authenticated client connections
- Verifying that unauthenticated requests are rejected with `isError`

## Related

- See `test-auth` for the full authentication testing reference
