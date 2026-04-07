/**
 * E2E Tests for Authorities — RBAC/ABAC/ReBAC Enforcement
 *
 * Tests the built-in AuthoritiesPlugin enforcement:
 * - RBAC roles/permissions checks
 * - ABAC attribute conditions (with dynamic fromInput)
 * - Authority profiles (string and array forms)
 * - Combinators (anyOf, allOf, not)
 * - Discovery filtering (unauthorized tools hidden from list)
 * - Zero-cost bypass (tools without authorities remain accessible)
 *
 * Uses MockOAuthServer + TestTokenFactory to create JWT tokens
 * with specific roles/permissions/claims for each test scenario.
 */
import { TestServer, TestTokenFactory, MockOAuthServer, McpTestClient, expect } from '@frontmcp/testing';

describe('Authorities E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    // Create initial token factory
    tokenFactory = new TestTokenFactory({
      issuer: 'http://localhost',
      audience: 'frontmcp-test',
    });

    // Start mock OAuth to get port
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();
    await mockOAuth.stop();

    // Recreate with correct issuer
    tokenFactory = new TestTokenFactory({
      issuer: oauthInfo.issuer,
      audience: oauthInfo.issuer,
    });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();

    // Start MCP server with authorities plugin
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-authorities/src/main.ts',
      env: {
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterAll(async () => {
    if (server) await server.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  async function connectWithClaims(claims: Record<string, unknown>): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({
      sub: claims['sub'] as string ?? 'test-user',
      claims,
    });
    return McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
  }

  // =============================================
  // Zero-cost: Tools without authorities
  // =============================================

  describe('Public tool (no authorities)', () => {
    it('should allow any authenticated user to call a tool without authorities', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: [] });
      const result = await client.tools.call('public-tool', { message: 'hi' });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('hi');
      await client.disconnect();
    });
  });

  // =============================================
  // RBAC — Roles
  // =============================================

  describe('RBAC roles enforcement', () => {
    it('should allow user with required role', async () => {
      const client = await connectWithClaims({ sub: 'admin-user', roles: ['admin'] });
      const result = await client.tools.call('admin-only', { action: 'delete' });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('admin action');
      await client.disconnect();
    });

    it('should deny user without required role', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const result = await client.tools.call('admin-only', { action: 'delete' });
      expect(result).toBeError();
      await client.disconnect();
    });

    it('should allow superadmin (any: admin | superadmin)', async () => {
      const client = await connectWithClaims({ sub: 'super', roles: ['superadmin'] });
      const result = await client.tools.call('admin-only', { action: 'override' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });
  });

  // =============================================
  // RBAC — Permissions
  // =============================================

  describe('RBAC permissions enforcement', () => {
    it('should allow user with all required permissions', async () => {
      const client = await connectWithClaims({
        sub: 'editor',
        permissions: ['users:read', 'users:write'],
      });
      const result = await client.tools.call('permissions-required', { resource: 'users' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should deny user missing a required permission', async () => {
      const client = await connectWithClaims({
        sub: 'reader',
        permissions: ['users:read'],
      });
      const result = await client.tools.call('permissions-required', { resource: 'users' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // ABAC — Tenant Scoping
  // =============================================

  describe('ABAC tenant scoping', () => {
    it('should allow user accessing their own tenant', async () => {
      const client = await connectWithClaims({
        sub: 'user-1',
        tenantId: 'tenant-42',
      });
      const result = await client.tools.call('tenant-scoped', {
        tenantId: 'tenant-42',
        data: 'my-data',
      });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('tenant-42');
      await client.disconnect();
    });

    it('should deny user accessing a different tenant', async () => {
      const client = await connectWithClaims({
        sub: 'user-1',
        tenantId: 'tenant-42',
      });
      const result = await client.tools.call('tenant-scoped', {
        tenantId: 'tenant-99',
        data: 'stolen',
      });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Profiles — String shorthand
  // =============================================

  describe('Profile-based authorities', () => {
    it('should allow admin via "admin" profile', async () => {
      const client = await connectWithClaims({ sub: 'admin-user', roles: ['admin'] });
      const result = await client.tools.call('profile-admin', { query: 'check' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should deny non-admin via "admin" profile', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const result = await client.tools.call('profile-admin', { query: 'check' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Profiles — Array (AND semantics)
  // =============================================

  describe('Multi-profile authorities (AND)', () => {
    it('should allow when all profiles pass', async () => {
      const client = await connectWithClaims({
        sub: 'user-1',
        tenantId: 'tenant-100',
      });
      const result = await client.tools.call('profile-multi', {
        tenantId: 'tenant-100',
        value: 'ok',
      });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should deny when tenant does not match (matchTenant profile fails)', async () => {
      const client = await connectWithClaims({
        sub: 'user-1',
        tenantId: 'tenant-100',
      });
      const result = await client.tools.call('profile-multi', {
        tenantId: 'tenant-999',
        value: 'nope',
      });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Combinators — anyOf, allOf, not
  // =============================================

  describe('Combinator enforcement', () => {
    it('should allow superadmin via first anyOf branch', async () => {
      const client = await connectWithClaims({ sub: 'super', roles: ['superadmin'] });
      const result = await client.tools.call('combinator-tool', { action: 'superadmin' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should allow non-suspended admin via second anyOf branch (allOf + not)', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const result = await client.tools.call('combinator-tool', { action: 'admin' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should deny suspended admin (not combinator blocks)', async () => {
      const client = await connectWithClaims({
        sub: 'suspended-admin',
        roles: ['admin', 'suspended'],
      });
      const result = await client.tools.call('combinator-tool', { action: 'try' });
      expect(result).toBeError();
      await client.disconnect();
    });

    it('should deny user with no matching roles', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const result = await client.tools.call('combinator-tool', { action: 'nope' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // anyOf combinator — editor OR admin
  // =============================================

  describe('anyOf: editor or admin', () => {
    it('should allow admin', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const result = await client.tools.call('editor-or-admin', { content: 'post' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should allow editor (via permission)', async () => {
      const client = await connectWithClaims({
        sub: 'editor',
        roles: [],
        permissions: ['content:write'],
      });
      const result = await client.tools.call('editor-or-admin', { content: 'article' });
      expect(result).toBeSuccessful();
      await client.disconnect();
    });

    it('should deny user with neither role nor permission', async () => {
      const client = await connectWithClaims({
        sub: 'reader',
        roles: ['viewer'],
        permissions: ['content:read'],
      });
      const result = await client.tools.call('editor-or-admin', { content: 'nope' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Discovery Filtering — tools/list
  // =============================================

  describe('Discovery filtering', () => {
    it('should show all tools to a superadmin', async () => {
      const client = await connectWithClaims({
        sub: 'super',
        roles: ['superadmin'],
        permissions: ['users:read', 'users:write', 'content:write'],
        tenantId: 'any',
      });
      const tools = await client.tools.list();
      expect(tools).toContainTool('public-tool');
      expect(tools).toContainTool('admin-only');
      expect(tools).toContainTool('combinator-tool');
      await client.disconnect();
    });

    it('should hide admin tools from a viewer', async () => {
      const client = await connectWithClaims({
        sub: 'viewer',
        roles: ['viewer'],
        permissions: [],
      });
      const tools = await client.tools.list();
      // Public tool should always be visible
      expect(tools).toContainTool('public-tool');
      // Admin tools should be hidden
      expect(tools).not.toContainTool('admin-only');
      expect(tools).not.toContainTool('profile-admin');
      await client.disconnect();
    });
  });

  // =============================================
  // Resource authorities — authenticated
  // =============================================

  describe('Resource authorities', () => {
    it('should allow admin to read admin-config resource', async () => {
      const client = await connectWithClaims({ sub: 'admin-user', roles: ['admin'] });
      const content = await client.resources.read('config://admin-settings');
      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('admin-only-value');
      await client.disconnect();
    });

    it('should deny non-admin from reading admin-config resource', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const content = await client.resources.read('config://admin-settings');
      expect(content).toBeError();
      await client.disconnect();
    });

    it('should allow anyone to read public-info resource', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: [] });
      const content = await client.resources.read('info://public');
      expect(content).toBeSuccessful();
      await client.disconnect();
    });

    it('should show admin-config in resources/list for admin', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const resources = await client.resources.list();
      expect(resources).toContainResource('config://admin-settings');
      expect(resources).toContainResource('info://public');
      await client.disconnect();
    });

    it('should hide admin-config from resources/list for viewer', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const resources = await client.resources.list();
      expect(resources).toContainResource('info://public');
      expect(resources).not.toContainResource('config://admin-settings');
      await client.disconnect();
    });
  });

  // =============================================
  // Error structure verification
  // =============================================

  describe('Authority denial error structure', () => {
    it('should return structured denial in tool error response', async () => {
      const client = await connectWithClaims({
        sub: 'viewer',
        roles: ['viewer'],
        permissions: [],
      });
      const result = await client.tools.call('admin-only', { action: 'test' });
      expect(result).toBeError();
      // Error should contain authority denial info
      const text = JSON.stringify(result);
      expect(text.toLowerCase()).toMatch(/denied|authority|roles|forbidden/i);
      await client.disconnect();
    });

    it('should return structured denial for permission-based tool', async () => {
      const client = await connectWithClaims({
        sub: 'reader',
        permissions: ['users:read'],
      });
      const result = await client.tools.call('permissions-required', { resource: 'users' });
      expect(result).toBeError();
      const text = JSON.stringify(result);
      expect(text.toLowerCase()).toMatch(/denied|permission|missing/i);
      await client.disconnect();
    });

    it('should return structured denial for resource read', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const result = await client.resources.read('config://admin-settings');
      expect(result).toBeError();
      await client.disconnect();
    });
  });
});
