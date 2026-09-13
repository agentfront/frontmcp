/**
 * E2E regression guard for GHSA-58v2-gpcc-jmqv — job and workflow `permissions`
 * are not enforced.
 *
 * `@Job({ permissions: [...] })` is documented, schema-validated, and stored on
 * the entry, and the SDK ships a `JobPermissionGuard` written to evaluate it —
 * but nothing ever called it. Any caller who could reach `execute_job` could run
 * every job regardless of its declared roles, scopes, or custom rules.
 *
 * The suite drives the real MCP surface with real JWTs so the whole chain is
 * covered: token claims → AuthInfo → principal resolution → guard → execution.
 *
 * Also pinned here, because the same audit surfaced them:
 *   - dynamic job registration (`register_job` takes a raw script string) must
 *     be opt-in, not reachable by default;
 *   - `get_job_status` must not expose another session's run.
 *
 * The permission-less job is asserted to still run, so the fix cannot
 * over-correct into deny-by-default and break the documented contract that "when
 * no permissions are defined, the job is accessible to all authenticated users".
 */
import {
  expect,
  McpTestClient,
  MockOAuthServer,
  TestServer,
  TestTokenFactory,
  type McpTestClient as McpTestClientType,
} from '@frontmcp/testing';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-jobs/src/main.permissions.ts';

describe('Jobs/workflows permission enforcement (GHSA-58v2-gpcc-jmqv)', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    // Two-phase start so the token factory's issuer matches the mock IdP URL
    // exactly (the transparent verifier rejects a mismatched `iss`).
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const probe = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: probe.issuer, audience: probe.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: probe.port });
    const final = await mockOAuth.start();

    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-jobs',
      env: {
        IDP_PROVIDER_URL: final.baseUrl,
        IDP_EXPECTED_AUDIENCE: final.issuer,
      },
      startupTimeout: 60_000,
      debug: process.env['DEBUG'] === '1',
    });
  }, 90_000);

  afterAll(async () => {
    if (server) await server.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  /** Connect an MCP session whose JWT carries the given claims. */
  async function withClient<T>(
    claims: Record<string, unknown>,
    body: (client: McpTestClientType) => Promise<T>,
  ): Promise<T> {
    const token = await tokenFactory.createTestToken({
      sub: (claims['sub'] as string) ?? 'test-user',
      claims,
    });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      return await body(client);
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  const asAdmin = { sub: 'admin-user', roles: ['admin'] };
  const asUser = { sub: 'plain-user', roles: ['viewer'] };

  describe('execute permissions', () => {
    it('refuses a role-gated job for a caller without the role', async () => {
      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('execute_job', { name: 'admin-only', input: { confirm: 'yes' } });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('ADMIN-JOB-RAN');
      });
    });

    it('refuses a role-gated job for a caller with no roles at all', async () => {
      await withClient({ sub: 'roleless' }, async (mcp) => {
        const result = await mcp.tools.call('execute_job', { name: 'admin-only', input: { confirm: 'yes' } });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('ADMIN-JOB-RAN');
      });
    });

    it('runs a role-gated job for a caller holding the role', async () => {
      await withClient(asAdmin, async (mcp) => {
        const result = await mcp.tools.call('execute_job', { name: 'admin-only', input: { confirm: 'yes' } });

        expect(result.isError).toBe(false);
        expect(JSON.stringify(result)).toContain('ADMIN-JOB-RAN');
      });
    });

    it('refuses a scope-gated job for a caller without the scope', async () => {
      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('execute_job', { name: 'scoped-report', input: { range: '7d' } });

        expect(result.isError).toBe(true);
      });
    });

    it('runs a scope-gated job for a caller holding the scope', async () => {
      await withClient({ sub: 'reporter', scope: 'openid reports:run' }, async (mcp) => {
        const result = await mcp.tools.call('execute_job', { name: 'scoped-report', input: { range: '7d' } });

        expect(result.isError).toBe(false);
      });
    });

    it('still runs a job that declares no permissions (documented allow-all)', async () => {
      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('execute_job', { name: 'open', input: { value: 'x' } });

        expect(result.isError).toBe(false);
      });
    });

    it('enforces the same rules on a background run (no async escape hatch)', async () => {
      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('execute_job', {
          name: 'admin-only',
          input: { confirm: 'yes' },
          background: true,
        });

        expect(result.isError).toBe(true);
      });
    });

    it('refuses a role-gated workflow for a caller without the role', async () => {
      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('execute_workflow', { name: 'admin-only-flow' });

        expect(result.isError).toBe(true);
      });
    });

    it('runs a role-gated workflow for a caller holding the role', async () => {
      await withClient(asAdmin, async (mcp) => {
        const result = await mcp.tools.call('execute_workflow', { name: 'admin-only-flow' });

        expect(result.isError).toBe(false);
      });
    });
  });

  describe('list permissions', () => {
    it('hides a job the caller may not execute', async () => {
      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('list_jobs', {});
        const names = (result.json<{ jobs: Array<{ name: string }> }>().jobs ?? []).map((j) => j.name);

        expect(names).toContain('open');
        expect(names).not.toContain('admin-only');
      });
    });

    it('lists it for a caller who may execute it', async () => {
      await withClient(asAdmin, async (mcp) => {
        const result = await mcp.tools.call('list_jobs', {});
        const names = (result.json<{ jobs: Array<{ name: string }> }>().jobs ?? []).map((j) => j.name);

        expect(names).toContain('admin-only');
      });
    });
  });

  describe('dynamic registration', () => {
    it('refuses register_job unless dynamic registration is explicitly enabled', async () => {
      await withClient(asAdmin, async (mcp) => {
        const result = await mcp.tools.call('register_job', {
          name: 'injected',
          script: 'export default async () => ({ pwned: true });',
        });

        expect(result.isError).toBe(true);
      });
    });
  });

  describe('run isolation', () => {
    it('does not expose another session run to a different caller', async () => {
      const runId = await withClient(asAdmin, async (mcp) => {
        const started = await mcp.tools.call('execute_job', {
          name: 'admin-only',
          input: { confirm: 'yes' },
          background: true,
        });
        return started.json<{ runId: string }>().runId;
      });

      expect(typeof runId).toBe('string');

      await withClient(asUser, async (mcp) => {
        const result = await mcp.tools.call('get_job_status', { runId });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('ADMIN-JOB-RAN');
      });
    });
  });
});
