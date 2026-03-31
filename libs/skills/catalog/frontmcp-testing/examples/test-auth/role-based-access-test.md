---
name: role-based-access-test
reference: test-auth
level: intermediate
description: 'Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints.'
tags: [testing, auth, role, based, access]
features:
  - 'Creating tokens with different `roles` arrays to simulate admin and user access'
  - 'Testing that admin-only tools accept admin tokens and reject user tokens'
  - 'Verifying that user-level tools remain accessible to users with the correct role'
  - 'Each test creates and closes its own client for proper isolation'
---

# Testing Role-Based Access Control

Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints.

## Code

```typescript
// src/__tests__/rbac.e2e.spec.ts
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';
import Server from '../src/main';

describe('Role-Based Access', () => {
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

  it('should allow admin access to admin-only tool', async () => {
    const adminToken = await tokenFactory.createToken({
      sub: 'admin-1',
      roles: ['admin'],
    });

    const client = await server.connect({ authToken: adminToken });
    const result = await client.callTool('admin_only_tool', {});
    expect(result).toBeSuccessful();
    await client.close();
  });

  it('should deny user access to admin-only tool', async () => {
    const userToken = await tokenFactory.createToken({
      sub: 'user-1',
      roles: ['user'],
    });

    const client = await server.connect({ authToken: userToken });
    const result = await client.callTool('admin_only_tool', {});
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('should allow user access to user-level tool', async () => {
    const userToken = await tokenFactory.createToken({
      sub: 'user-2',
      roles: ['user'],
    });

    const client = await server.connect({ authToken: userToken });
    const result = await client.callTool('user_tool', { data: 'hello' });
    expect(result).toBeSuccessful();
    await client.close();
  });
});
```

## What This Demonstrates

- Creating tokens with different `roles` arrays to simulate admin and user access
- Testing that admin-only tools accept admin tokens and reject user tokens
- Verifying that user-level tools remain accessible to users with the correct role
- Each test creates and closes its own client for proper isolation

## Related

- See `test-auth` for the full authentication testing reference
