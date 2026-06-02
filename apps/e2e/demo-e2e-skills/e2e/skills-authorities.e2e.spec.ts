/**
 * E2E Tests for `@Skill({ authorities })` Enforcement
 *
 * Boots the skills fixture in authorities mode (transparent IdP + authorities
 * engine, AUTHORITIES_MODE=1) and verifies the `admin-gated` skill is:
 *   - DENIED on direct load/read for an unauthorized caller
 *     (skills/load + skill://admin-gated/SKILL.md → error / -32003), and
 *   - HIDDEN from discovery (skills/search, skill://index.json) for an
 *     unauthorized caller,
 * while an `admin` caller can both discover and load it. Skills WITHOUT
 * authorities (e.g. review-pr) remain visible and loadable for everyone.
 */
import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface SkillIndexDocument {
  $schema: string;
  skills: Array<{ type: string; name?: string; description: string; url: string }>;
}

let reqId = 5000;

describe('Skill Authorities E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const info = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: info.issuer, audience: info.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: info.port });
    const finalInfo = await mockOAuth.start();

    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-skills/src/main.ts',
      env: {
        AUTHORITIES_MODE: '1',
        IDP_PROVIDER_URL: finalInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalInfo.issuer,
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
      sub: (claims['sub'] as string) ?? 'test-user',
      claims,
    });
    return McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
  }

  function rpc(method: string, params: Record<string, unknown>): JsonRpcRequest {
    return { jsonrpc: '2.0', id: reqId++, method, params };
  }

  function indexDoc(read: { raw?: { contents?: Array<{ text?: string }> } }): SkillIndexDocument {
    const text = read?.raw?.contents?.[0]?.text;
    if (!text) throw new Error('no index text');
    return JSON.parse(text) as SkillIndexDocument;
  }

  // ============================================================
  // Direct load deny (skills/load)
  // ============================================================

  describe('skills/load — direct load deny', () => {
    it('allows an admin to load the gated skill', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const res = await client.raw.request(rpc('skills/load', { skillIds: ['admin-gated'] }));
      expect(res.error).toBeUndefined();
      const result = res.result as { skills: Array<{ id: string }> };
      expect(result.skills.map((s) => s.id)).toContain('admin-gated');
      await client.disconnect();
    });

    it('denies a non-admin from loading the gated skill (-32003)', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.raw.request(rpc('skills/load', { skillIds: ['admin-gated'] }));
      expect(res.error).toBeDefined();
      expect(res.error?.code).toBe(-32003);
      await client.disconnect();
    });

    it('allows everyone to load a skill without authorities (review-pr)', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.raw.request(rpc('skills/load', { skillIds: ['review-pr'] }));
      expect(res.error).toBeUndefined();
      const result = res.result as { skills: Array<{ id: string }> };
      expect(result.skills.map((s) => s.id)).toContain('review-pr');
      await client.disconnect();
    });
  });

  // ============================================================
  // SEP-2640 skill:// read deny
  // ============================================================

  describe('skill://admin-gated/SKILL.md — resource read deny', () => {
    it('allows an admin to read the gated SKILL.md', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const res = await client.resources.read('skill://admin-gated/SKILL.md');
      expect(res).toBeSuccessful();
      await client.disconnect();
    });

    it('denies a non-admin from reading the gated SKILL.md', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.resources.read('skill://admin-gated/SKILL.md');
      expect(res).toBeError();
      await client.disconnect();
    });

    it('allows everyone to read a SKILL.md without authorities (review-pr)', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.resources.read('skill://review-pr/SKILL.md');
      expect(res).toBeSuccessful();
      await client.disconnect();
    });
  });

  // ============================================================
  // Discovery filtering (skills/search + skill://index.json)
  // ============================================================

  describe('Discovery filtering', () => {
    it('hides the gated skill from a non-admin in skills/search', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.raw.request(rpc('skills/search', { query: 'admin restricted workflow' }));
      expect(res.error).toBeUndefined();
      const result = res.result as { skills: Array<{ id: string }> };
      expect(result.skills.map((s) => s.id)).not.toContain('admin-gated');
      await client.disconnect();
    });

    it('shows the gated skill to an admin in skills/search', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const res = await client.raw.request(rpc('skills/search', { query: 'admin restricted workflow' }));
      expect(res.error).toBeUndefined();
      const result = res.result as { skills: Array<{ id: string }> };
      expect(result.skills.map((s) => s.id)).toContain('admin-gated');
      await client.disconnect();
    });

    it('hides the gated skill from skill://index.json for a non-admin', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.resources.read('skill://index.json');
      expect(res).toBeSuccessful();
      const names = indexDoc(res as never).skills.map((s) => s.name);
      expect(names).not.toContain('admin-gated');
      // Unrestricted skills still listed.
      expect(names).toContain('review-pr');
      await client.disconnect();
    });

    it('shows the gated skill in skill://index.json for an admin', async () => {
      const client = await connectWithClaims({ sub: 'admin', roles: ['admin'] });
      const res = await client.resources.read('skill://index.json');
      expect(res).toBeSuccessful();
      const names = indexDoc(res as never).skills.map((s) => s.name);
      expect(names).toContain('admin-gated');
      await client.disconnect();
    });
  });
});
