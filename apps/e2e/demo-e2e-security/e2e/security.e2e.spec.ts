/**
 * Security smoke tests — every auth boundary in one suite.
 *
 * Philosophy: tests here MUST fail loud if any protected MCP entry point
 * starts accepting unauthenticated or under-authorized callers. The positive
 * ("happy path") assertions exist only to confirm the pipeline can grant
 * access at all; the negative ones are the smoke alarms.
 *
 * Coverage:
 *   - transport-level auth (anonymous / invalid / expired / wrong-issuer JWT)
 *   - tool-level authorities (RBAC profile + ABAC input-bound tenant match)
 *   - tools/list filtering for unauthorized callers
 *   - task-augmented tools/call must enforce authorities synchronously,
 *     BEFORE creating any task record (the fix from the CLI tasks PR)
 *   - cross-session task access (get / result / cancel / list)
 *   - taskId enumeration via guessed/foreign IDs returns uniform -32602
 */
import {
  expect,
  McpTestClient,
  MockOAuthServer,
  TestServer,
  TestTokenFactory,
  type McpTestClient as McpTestClientType,
} from '@frontmcp/testing';

describe('Security E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    // Two-phase start: start once to discover the assigned port, then recreate
    // so the token factory's issuer matches the mock OAuth's URL exactly
    // (the transparent-auth verifier rejects tokens with mismatched `iss`).
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const probe = await mockOAuth.start();
    await mockOAuth.stop();

    tokenFactory = new TestTokenFactory({ issuer: probe.issuer, audience: probe.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: probe.port });
    const final = await mockOAuth.start();

    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-security/src/main.ts',
      env: {
        IDP_PROVIDER_URL: final.baseUrl,
        IDP_EXPECTED_AUDIENCE: final.issuer,
      },
      startupTimeout: 30_000,
      debug: false,
    });
  }, 60_000);

  afterAll(async () => {
    if (server) await server.stop();
    if (mockOAuth) await mockOAuth.stop();
  });

  // ───────────────────── Helpers ─────────────────────

  async function connectWithClaims(claims: Record<string, unknown>): Promise<McpTestClientType> {
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

  type RpcResponse<T = unknown> = {
    jsonrpc: '2.0';
    id: string | number;
    result?: T;
    error?: { code: number; message: string };
  };

  let rpcCounter = 1000;
  const rpcId = () => ++rpcCounter;

  const taskAugmentedCall = (
    mcp: McpTestClientType,
    name: string,
    args: Record<string, unknown>,
  ): Promise<RpcResponse<{ task?: { taskId: string; status: string } }>> =>
    mcp.raw.request({
      jsonrpc: '2.0',
      id: rpcId(),
      method: 'tools/call',
      params: { name, arguments: args, task: {} },
    }) as Promise<RpcResponse<{ task?: { taskId: string; status: string } }>>;

  const tasksGet = (mcp: McpTestClientType, taskId: string) =>
    mcp.raw.request({ jsonrpc: '2.0', id: rpcId(), method: 'tasks/get', params: { taskId } }) as Promise<
      RpcResponse<{ status: string }>
    >;

  const tasksResult = (mcp: McpTestClientType, taskId: string) =>
    mcp.raw.request({
      jsonrpc: '2.0',
      id: rpcId(),
      method: 'tasks/result',
      params: { taskId },
    }) as Promise<RpcResponse>;

  const tasksCancel = (mcp: McpTestClientType, taskId: string) =>
    mcp.raw.request({
      jsonrpc: '2.0',
      id: rpcId(),
      method: 'tasks/cancel',
      params: { taskId },
    }) as Promise<RpcResponse>;

  const tasksList = (mcp: McpTestClientType) =>
    mcp.raw.request({ jsonrpc: '2.0', id: rpcId(), method: 'tasks/list', params: {} }) as Promise<
      RpcResponse<{ tasks: Array<{ taskId: string }> }>
    >;

  // ───────────────────── Tests ─────────────────────

  describe('transport-level auth', () => {
    test('anonymous client (no token) cannot connect when allowAnonymous: false', async () => {
      // Connecting without a token MUST be rejected by the transparent-auth
      // verifier — either at connect() time or on the first RPC. We treat
      // "either fails" as pass; what we refuse to accept is a successful call.
      await expect(
        (async () => {
          const client = await McpTestClient.create({
            baseUrl: server.info.baseUrl,
            transport: 'streamable-http',
          }).buildAndConnect();
          try {
            await client.tools.list();
          } finally {
            await client.disconnect().catch(() => undefined);
          }
        })(),
      ).rejects.toBeDefined();
    });

    test('malformed token is rejected', async () => {
      await expect(
        (async () => {
          const client = await McpTestClient.create({
            baseUrl: server.info.baseUrl,
            transport: 'streamable-http',
            auth: { token: 'not-a-jwt' },
          }).buildAndConnect();
          try {
            await client.tools.list();
          } finally {
            await client.disconnect().catch(() => undefined);
          }
        })(),
      ).rejects.toBeDefined();
    });

    test('token signed by a different issuer is rejected', async () => {
      const strangerFactory = new TestTokenFactory({
        issuer: 'https://not-our-idp.test',
        audience: 'https://not-our-idp.test',
      });
      const token = await strangerFactory.createTestToken({ sub: 'attacker' });
      await expect(
        (async () => {
          const client = await McpTestClient.create({
            baseUrl: server.info.baseUrl,
            transport: 'streamable-http',
            auth: { token },
          }).buildAndConnect();
          try {
            await client.tools.list();
          } finally {
            await client.disconnect().catch(() => undefined);
          }
        })(),
      ).rejects.toBeDefined();
    });

    test('expired token is rejected', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'expired-user',
        // Expose `exp` as a past UNIX timestamp via custom claims.
        // jose's `setExpirationTime` accepts either a duration string or an
        // absolute epoch; the token factory treats `exp` as "seconds from now",
        // so use a past offset to produce an already-expired JWT.
        exp: -60,
      });
      await expect(
        (async () => {
          const client = await McpTestClient.create({
            baseUrl: server.info.baseUrl,
            transport: 'streamable-http',
            auth: { token },
          }).buildAndConnect();
          try {
            await client.tools.list();
          } finally {
            await client.disconnect().catch(() => undefined);
          }
        })(),
      ).rejects.toBeDefined();
    });
  });

  describe('authority enforcement on tools/call', () => {
    test('authenticated caller without authorities can invoke a public (unguarded) tool', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: [] });
      const res = await client.tools.call('public-note', { message: 'hello' });
      expect(res).toBeSuccessful();
      await client.disconnect();
    });

    test('non-admin is DENIED on admin-memo (RBAC)', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.tools.call('admin-memo', { subject: 'Q4 layoffs' });
      expect(res).toBeError();
      await client.disconnect();
    });

    test('admin is ALLOWED on admin-memo', async () => {
      const client = await connectWithClaims({ sub: 'chief', roles: ['admin'] });
      const res = await client.tools.call('admin-memo', { subject: 'Q4 layoffs' });
      expect(res).toBeSuccessful();
      await client.disconnect();
    });

    test('tenant-read — same-tenant caller allowed', async () => {
      const client = await connectWithClaims({ sub: 'u1', tenantId: 'tenant-alpha' });
      const res = await client.tools.call('tenant-read', { tenantId: 'tenant-alpha' });
      expect(res).toBeSuccessful();
      await client.disconnect();
    });

    test('tenant-read — cross-tenant IDOR attempt denied (ABAC)', async () => {
      const client = await connectWithClaims({ sub: 'u1', tenantId: 'tenant-alpha' });
      const res = await client.tools.call('tenant-read', { tenantId: 'tenant-beta' });
      expect(res).toBeError();
      await client.disconnect();
    });
  });

  describe('tools/list filtering', () => {
    test('non-admin does not see admin-guarded tools on tools/list', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const tools = await client.tools.list();
      const names = tools.map((t) => t.name);
      expect(names).toContain('public-note');
      expect(names).not.toContain('admin-memo');
      expect(names).not.toContain('admin-background-job');
      await client.disconnect();
    });

    test('admin sees the admin-guarded tools', async () => {
      const client = await connectWithClaims({ sub: 'chief', roles: ['admin'] });
      const tools = await client.tools.list();
      const names = tools.map((t) => t.name);
      expect(names).toContain('admin-memo');
      expect(names).toContain('admin-background-job');
      await client.disconnect();
    });
  });

  describe('task-augmented calls — authority enforced BEFORE task creation', () => {
    test('non-admin task-augmented call on admin-background-job is denied synchronously', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await taskAugmentedCall(client, 'admin-background-job', { label: 'nightly' });
      // Two acceptable shapes: a JSON-RPC protocol error (ideal), OR a
      // CallToolResult with isError: true. Both MUST lack a taskId.
      expect(res.result?.task?.taskId).toBeUndefined();
      if (!res.error) {
        // fallback: CallToolResult form
        expect((res.result as unknown as { isError?: boolean })?.isError).toBeTruthy();
      }
      // And nothing should leak into tasks/list — neither the caller's own
      // session nor any other session should observe a task record.
      const list = await tasksList(client);
      const taskIds = (list.result?.tasks ?? []).map((t) => t.taskId);
      expect(taskIds).toEqual([]);
      await client.disconnect();
    });

    test('admin task-augmented call on admin-background-job succeeds and returns a taskId', async () => {
      const client = await connectWithClaims({ sub: 'chief', roles: ['admin'] });
      const res = await taskAugmentedCall(client, 'admin-background-job', { label: 'nightly' });
      expect(res.result?.task?.taskId).toMatch(/.+/);
      await client.disconnect();
    });

    test('non-admin cannot enumerate admin tasks via tasks/list', async () => {
      const admin = await connectWithClaims({ sub: 'chief', roles: ['admin'] });
      const created = await taskAugmentedCall(admin, 'admin-background-job', { label: 'enumeration-probe' });
      const adminTaskId = created.result?.task?.taskId;
      expect(adminTaskId).toBeDefined();

      const viewer = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const list = await tasksList(viewer);
      const ids = (list.result?.tasks ?? []).map((t) => t.taskId);
      expect(ids).not.toContain(adminTaskId);

      await admin.disconnect();
      await viewer.disconnect();
    });
  });

  describe('cross-session task access — spec §Security', () => {
    test('session B cannot read, block-on-result, or cancel a task owned by session A', async () => {
      // Two admins, same role, different sub → different sessions.
      const alice = await connectWithClaims({ sub: 'admin-alice', roles: ['admin'] });
      const bob = await connectWithClaims({ sub: 'admin-bob', roles: ['admin'] });

      const created = await taskAugmentedCall(alice, 'admin-background-job', { label: 'alice-only' });
      const taskId = created.result?.task?.taskId;
      expect(taskId).toBeDefined();
      if (!taskId) throw new Error('no taskId');

      const get = await tasksGet(bob, taskId);
      expect(get.error?.code).toBe(-32602);

      const result = await tasksResult(bob, taskId);
      expect(result.error?.code).toBe(-32602);

      const cancel = await tasksCancel(bob, taskId);
      expect(cancel.error?.code).toBe(-32602);

      // Alice can still read her own task.
      const aliceGet = await tasksGet(alice, taskId);
      expect(aliceGet.result?.status).toMatch(/^(working|completed|failed|cancelled)$/);

      await alice.disconnect();
      await bob.disconnect();
    });

    test('guessed / foreign taskIds return the same -32602 (no info disclosure)', async () => {
      const victim = await connectWithClaims({ sub: 'admin-victim', roles: ['admin'] });
      const created = await taskAugmentedCall(victim, 'admin-background-job', { label: 'secret' });
      const realTaskId = created.result?.task?.taskId;
      expect(realTaskId).toBeDefined();

      const attacker = await connectWithClaims({ sub: 'admin-attacker', roles: ['admin'] });

      // "foreign ID" = a real taskId owned by a different session.
      const foreignGet = await tasksGet(attacker, realTaskId as string);
      // "guessed ID" = a well-formed-looking but nonexistent UUID.
      const guessedGet = await tasksGet(attacker, '00000000-0000-4000-8000-000000000000');
      // "garbage ID" = complete nonsense.
      const garbageGet = await tasksGet(attacker, 'not-even-a-uuid-€€€');

      // Every non-owned lookup must produce the same code.
      expect(foreignGet.error?.code).toBe(-32602);
      expect(guessedGet.error?.code).toBe(-32602);
      expect(garbageGet.error?.code).toBe(-32602);
      // And the messages MUST NOT disambiguate "exists elsewhere" from
      // "never existed" — otherwise attackers can enumerate valid taskIds.
      expect(foreignGet.error?.message).toBe(guessedGet.error?.message);
      expect(foreignGet.error?.message).toBe(garbageGet.error?.message);

      await victim.disconnect();
      await attacker.disconnect();
    });
  });

  describe('resources auth — authorities + listing filter', () => {
    test('authenticated caller can read the public resource', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.resources.read('info://public');
      // ResourceContentWrapper: text() or contents() helpers return content.
      expect(res).toBeDefined();
      await client.disconnect();
    });

    test('non-admin is DENIED on admin-config read', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = (await client.raw.request({
        jsonrpc: '2.0',
        id: rpcId(),
        method: 'resources/read',
        params: { uri: 'config://admin-settings' },
      })) as RpcResponse;
      // Authority denial surfaces as a JSON-RPC error (not a successful read
      // with weird content). The exact code family is what matters — don't
      // pin the specific numeric code since it may shift between
      // -32603 (internal) and -32002 (resource-not-found) depending on
      // whether the authorities engine hides existence.
      expect(res.error).toBeDefined();
      await client.disconnect();
    });

    test('non-admin resources/list excludes admin-config', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const resources = await client.resources.list();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('info://public');
      expect(uris).not.toContain('config://admin-settings');
      await client.disconnect();
    });

    test('admin sees + reads admin-config', async () => {
      const client = await connectWithClaims({ sub: 'chief', roles: ['admin'] });
      const resources = await client.resources.list();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('config://admin-settings');
      const res = await client.resources.read('config://admin-settings');
      expect(res).toBeDefined();
      await client.disconnect();
    });
  });

  describe('prompts auth — authorities + listing filter', () => {
    test('authenticated caller can fetch the public prompt', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = await client.prompts.get('public-hello', { name: 'world' });
      expect(res).toBeDefined();
      await client.disconnect();
    });

    test('non-admin is DENIED on admin-briefing', async () => {
      const client = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const res = (await client.raw.request({
        jsonrpc: '2.0',
        id: rpcId(),
        method: 'prompts/get',
        params: { name: 'admin-briefing', arguments: { date: '2026-04-18' } },
      })) as RpcResponse;
      expect(res.error).toBeDefined();
      await client.disconnect();
    });

    test('prompts/list filters by authorities', async () => {
      const nonAdmin = await connectWithClaims({ sub: 'viewer', roles: ['viewer'] });
      const nonAdminPrompts = (await nonAdmin.prompts.list()).map((p) => p.name);
      expect(nonAdminPrompts).toContain('public-hello');
      expect(nonAdminPrompts).not.toContain('admin-briefing');
      await nonAdmin.disconnect();

      const admin = await connectWithClaims({ sub: 'chief', roles: ['admin'] });
      const adminPrompts = (await admin.prompts.list()).map((p) => p.name);
      expect(adminPrompts).toContain('admin-briefing');
      await admin.disconnect();
    });
  });

  describe('elicitation — cross-session isolation', () => {
    test("session B cannot hijack session A's pending elicit", async () => {
      // Alice triggers an elicit but does NOT register an onElicitation handler,
      // so her server-side pending elicit sits waiting. The tool's 2s ttl caps
      // how long we block — long enough for Bob to try his spoofing attempt.
      const alice = await connectWithClaims({ sub: 'alice', roles: ['viewer'] });
      const bob = await connectWithClaims({ sub: 'bob', roles: ['viewer'] });

      // Fire-and-forget Alice's elicit — the promise resolves when the tool
      // returns (after elicit cancel / decline / timeout).
      const alicePromise = alice.tools.call('elicit-secret', { prompt: 'your secret?' });

      // Give the server a moment to persist the pending elicit record.
      await new Promise((r) => setTimeout(r, 100));

      // Bob attempts to post elicitation results for assorted IDs: a random
      // UUID, and the literal string 'alice' (in case an attacker guesses a
      // session-ID-based key). The server's session-keyed elicit store must
      // reject each attempt without affecting Alice.
      const spoofAttempts = ['00000000-0000-4000-8000-000000000000', 'alice', 'urn:mcp:elicit:alice:1'];
      for (const elicitId of spoofAttempts) {
        await bob.raw
          .request({
            jsonrpc: '2.0',
            id: rpcId(),
            method: 'elicitation/result',
            params: {
              sessionId: 'alice', // fake sessionId — store must reject
              elicitId,
              result: { action: 'accept', content: { secret: 'p0wn3d' } },
            },
          })
          .catch(() => undefined); // we don't care if the RPC is rejected outright
      }

      // Alice's elicit MUST timeout (no legitimate response arrived). Assert
      // two things: (1) Bob's payload never reached Alice's tool result, and
      // (2) the call resolves within a reasonable bound so we don't hang CI.
      const aliceResult = await alicePromise;
      const text = aliceResult.text?.() ?? '';
      expect(text).not.toContain('p0wn3d');

      await alice.disconnect();
      await bob.disconnect();
    });
  });
});
