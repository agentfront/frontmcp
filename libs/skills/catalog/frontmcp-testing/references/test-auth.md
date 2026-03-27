# Testing with Authentication

```typescript
import { McpTestClient, TestServer, TestTokenFactory, MockOAuthServer } from '@frontmcp/testing';
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

  it('should enforce role-based access', async () => {
    const adminToken = await tokenFactory.createToken({
      sub: 'admin-1',
      roles: ['admin'],
    });
    const userToken = await tokenFactory.createToken({
      sub: 'user-1',
      roles: ['user'],
    });

    const adminClient = await server.connect({ authToken: adminToken });
    const adminResult = await adminClient.callTool('admin_only_tool', {});
    expect(adminResult).toBeSuccessful();

    const userClient = await server.connect({ authToken: userToken });
    const userResult = await userClient.callTool('admin_only_tool', {});
    expect(userResult.isError).toBe(true);

    await adminClient.close();
    await userClient.close();
  });
});

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
});
```
