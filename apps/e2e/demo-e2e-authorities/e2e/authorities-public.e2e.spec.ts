/**
 * E2E Tests for Authorities in PUBLIC Mode
 *
 * Tests the authorities system when the server runs in public mode
 * (no authentication required). Anonymous users hit tools with
 * `authorities` metadata — verifying that:
 * - Tools without authorities are accessible to anonymous users
 * - Tools with role-based authorities deny anonymous users (no roles)
 * - Tools with permission-based authorities deny anonymous users (no permissions)
 * - tools/list filters out unauthorized tools from anonymous users
 *
 * In public mode, authInfo.user is: { sub: 'anon:<uuid>', iss: 'public', name: 'Anonymous' }
 * This user has no roles, no permissions, and no custom claims.
 */
import { TestServer, McpTestClient, expect } from '@frontmcp/testing';

describe('Authorities in Public Mode', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-authorities/src/main.ts',
      env: {
        AUTH_MODE: 'public',
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  async function connectAnonymous(): Promise<McpTestClient> {
    return McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
    }).buildAndConnect();
  }

  // =============================================
  // Public tool — no authorities
  // =============================================

  describe('Public tool (no authorities)', () => {
    it('should allow anonymous user to call a tool without authorities', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('public-tool', { message: 'hello from anonymous' });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('hello from anonymous');
      await client.disconnect();
    });
  });

  // =============================================
  // Admin-only tool — anonymous denied
  // =============================================

  describe('Admin-only tool (RBAC roles)', () => {
    it('should deny anonymous user from admin-only tool', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('admin-only', { action: 'delete' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Permissions tool — anonymous denied
  // =============================================

  describe('Permissions tool (RBAC permissions)', () => {
    it('should deny anonymous user from permissions-required tool', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('permissions-required', { resource: 'users' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Profile-based tool — anonymous denied
  // =============================================

  describe('Profile admin tool', () => {
    it('should deny anonymous user from profile-admin tool', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('profile-admin', { query: 'check' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Combinator tool — anonymous denied
  // =============================================

  describe('Combinator tool (anyOf with roles)', () => {
    it('should deny anonymous user from combinator tool', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('combinator-tool', { action: 'try' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Discovery filtering — anonymous sees only public
  // =============================================

  describe('Discovery filtering for anonymous user', () => {
    it('should show public tool in tools/list', async () => {
      const client = await connectAnonymous();
      const tools = await client.tools.list();
      expect(tools).toContainTool('public-tool');
      await client.disconnect();
    });

    it('should hide admin tools from anonymous user', async () => {
      const client = await connectAnonymous();
      const tools = await client.tools.list();
      expect(tools).not.toContainTool('admin-only');
      expect(tools).not.toContainTool('profile-admin');
      expect(tools).not.toContainTool('permissions-required');
      await client.disconnect();
    });
  });

  // =============================================
  // Additional tool denials — anonymous
  // =============================================

  describe('Editor-or-admin tool with anonymous', () => {
    it('should deny anonymous (no role, no permission)', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('editor-or-admin', { content: 'nope' });
      expect(result).toBeError();
      const text = JSON.stringify(result);
      expect(text.toLowerCase()).toMatch(/denied|authority|forbidden/i);
      await client.disconnect();
    });
  });

  describe('Tenant-scoped tool with anonymous', () => {
    it('should deny anonymous (no tenant claim)', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('tenant-scoped', { tenantId: 'any', data: 'x' });
      expect(result).toBeError();
      await client.disconnect();
    });
  });

  // =============================================
  // Error type verification
  // =============================================

  describe('Error content verification', () => {
    it('should return authority denial message (not generic error)', async () => {
      const client = await connectAnonymous();
      const result = await client.tools.call('admin-only', { action: 'test' });
      expect(result).toBeError();
      const text = JSON.stringify(result);
      // Error should mention authority/access denial, not a generic server error
      expect(text.toLowerCase()).toMatch(/denied|authority|roles|forbidden/i);
      await client.disconnect();
    });
  });

  // =============================================
  // Resource authorities — anonymous
  // =============================================

  describe('Resources with authorities (public mode)', () => {
    it('should show public resource in resources/list', async () => {
      const client = await connectAnonymous();
      const resources = await client.resources.list();
      expect(resources).toContainResource('info://public');
      await client.disconnect();
    });

    it('should hide admin resource from anonymous user', async () => {
      const client = await connectAnonymous();
      const resources = await client.resources.list();
      expect(resources).not.toContainResource('config://admin-settings');
      await client.disconnect();
    });

    it('should allow anonymous to read public resource', async () => {
      const client = await connectAnonymous();
      const content = await client.resources.read('info://public');
      expect(content).toBeSuccessful();
      await client.disconnect();
    });

    it('should deny anonymous reading admin resource', async () => {
      const client = await connectAnonymous();
      const content = await client.resources.read('config://admin-settings');
      expect(content).toBeError();
      await client.disconnect();
    });
  });
});
