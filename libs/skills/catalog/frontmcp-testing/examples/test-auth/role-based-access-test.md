---
name: role-based-access-test
reference: test-auth
level: intermediate
description: 'Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints.'
tags: [testing, auth, role-based-access]
features:
  - 'Putting roles inside `claims` (the `CreateTokenOptions` shape has no top-level `roles` field)'
  - 'Testing that admin-only tools accept admin tokens and reject user tokens'
  - 'Verifying that user-level tools remain accessible to users with the correct role'
  - 'Each test creates and disconnects its own client for proper isolation'
---

# Testing Role-Based Access Control

Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints.

## Code

```typescript
// src/__tests__/rbac.e2e.spec.ts
// Real API:
//   libs/testing/src/server/test-server.ts:101 — `TestServer.start({ command, port })`
//   libs/testing/src/auth/token-factory.ts:97 — `TestTokenFactory.createTestToken({ sub, scopes, claims })`
//   libs/testing/src/client/mcp-test-client.builder.ts — `McpTestClient.create(...).withToken(...).buildAndConnect()`
//   libs/testing/src/client/mcp-test-client.ts:306 — namespaced client API: `client.tools.call(name, args)`
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('Role-Based Access', () => {
  let server: TestServer;
  let tokenFactory: TestTokenFactory;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3011,
    });
    tokenFactory = new TestTokenFactory({
      issuer: 'https://test-idp.example.com',
      audience: 'my-api',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  async function clientWithToken(token: string): Promise<McpTestClient> {
    return McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .withToken(token)
      .buildAndConnect();
  }

  it('allows admin access to an admin-only tool', async () => {
    const adminToken = await tokenFactory.createTestToken({
      sub: 'admin-1',
      claims: { roles: ['admin'] },
    });

    const client = await clientWithToken(adminToken);
    try {
      const result = await client.tools.call('admin_only_tool', {});
      expect(result).toBeSuccessful();
    } finally {
      await client.disconnect();
    }
  });

  it('denies user access to an admin-only tool', async () => {
    const userToken = await tokenFactory.createTestToken({
      sub: 'user-1',
      claims: { roles: ['user'] },
    });

    const client = await clientWithToken(userToken);
    try {
      const result = await client.tools.call('admin_only_tool', {});
      expect(result).toBeError();
    } finally {
      await client.disconnect();
    }
  });

  it('allows user access to a user-level tool', async () => {
    const userToken = await tokenFactory.createTestToken({
      sub: 'user-2',
      claims: { roles: ['user'] },
    });

    const client = await clientWithToken(userToken);
    try {
      const result = await client.tools.call('user_tool', { data: 'hello' });
      expect(result).toBeSuccessful();
    } finally {
      await client.disconnect();
    }
  });
});
```

## What This Demonstrates

- Putting roles inside `claims` (the `CreateTokenOptions` shape has no top-level `roles` field)
- Testing that admin-only tools accept admin tokens and reject user tokens
- Verifying that user-level tools remain accessible to users with the correct role
- Each test creates and disconnects its own client for proper isolation

## Related

- See `test-auth` for the full authentication testing reference
