---
name: token-factory-test
reference: test-auth
level: basic
description: 'Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.'
tags: [testing, auth, token-factory]
features:
  - 'Creating a `TestTokenFactory` with issuer and audience configuration'
  - 'Generating test tokens with specific subjects and scopes via `createTestToken()`'
  - 'Building authenticated clients with `McpTestClient.create(...).withToken(token)`'
  - 'Using `.withPublicMode()` to suppress the anonymous token request and test unauthenticated rejection'
---

# Testing Authentication with TestTokenFactory

Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.

## Code

```typescript
// src/__tests__/auth.e2e.spec.ts
// Real API:
//   libs/testing/src/server/test-server.ts:101 — `TestServer.start({ command, port })`
//   libs/testing/src/auth/token-factory.ts:97 — `TestTokenFactory.createTestToken({ sub, scopes, claims })`
//   libs/testing/src/client/mcp-test-client.builder.ts — `withToken`, `withPublicMode`, `buildAndConnect`
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('Authenticated Server', () => {
  let server: TestServer;
  let tokenFactory: TestTokenFactory;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3012,
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
    // withPublicMode() = no Authorization header, no anonymous-token request.
    const client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .withPublicMode()
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
});
```

## What This Demonstrates

- Creating a `TestTokenFactory` with issuer and audience configuration
- Generating test tokens with specific subjects and scopes via `createTestToken()`
- Building authenticated clients with `McpTestClient.create(...).withToken(token)`
- Using `.withPublicMode()` to suppress the anonymous token request and test unauthenticated rejection

## Related

- See `test-auth` for the full authentication testing reference
