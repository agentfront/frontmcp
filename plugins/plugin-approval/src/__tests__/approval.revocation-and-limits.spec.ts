/**
 * `this.approval` revocation, time-limited and context grants, and the tool's `allowedScopes` and
 * `maxTtlMs`, through the real tools:call-tool flow.
 *
 * In 1.8.2 `revokeApproval()` deleted a key only time-limited and context grants use, so session
 * and user approvals stayed in force; time-limited and context grants were stored under keys the
 * gate never read; and nothing checked a grant against the tool's `allowedScopes` or `maxTtlMs`.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import {
  ApprovalPlugin,
  ApprovalRequiredError,
  ApprovalScope,
  ApprovalService,
  ApprovalState,
  ApprovalStorageStore,
  createApprovalService,
  type ApprovalRecord,
} from '../index';

const DEPLOY_ID = 'ops:deploy';
const LIMITED_ID = 'ops:limited_deploy';
const MAX_TTL_MS = 60_000;
const REPO_CONTEXT = { type: 'repository', identifier: 'acme/web' };

const executed: string[] = [];

@Tool({ name: 'deploy', inputSchema: {}, approval: true })
class DeployTool extends ToolContext {
  async execute() {
    executed.push('deploy');
    return { deployed: true };
  }
}

@Tool({
  name: 'limited_deploy',
  inputSchema: {},
  approval: { allowedScopes: [ApprovalScope.SESSION, ApprovalScope.TIME_LIMITED], maxTtlMs: MAX_TTL_MS },
})
class LimitedDeployTool extends ToolContext {
  async execute() {
    executed.push('limited_deploy');
    return { deployed: true };
  }
}

const OPS = ['session', 'user', 'time', 'context', 'revoke', 'clear', 'query'] as const;
type Op = (typeof OPS)[number];

const opInput = {
  op: z.enum(OPS),
  toolId: z.string(),
  ttlMs: z.number().optional(),
};

/** Runs one `this.approval` operation for the caller and reports its result or the error it threw. */
@Tool({ name: 'approvals', inputSchema: opInput })
class ApprovalsTool extends ToolContext {
  async execute({ op, toolId, ttlMs }: { op: Op; toolId: string; ttlMs?: number }) {
    try {
      switch (op) {
        case 'session':
          return { result: await this.approval.grantSessionApproval(toolId) };
        case 'user':
          return { result: await this.approval.grantUserApproval(toolId) };
        case 'time':
          return { result: await this.approval.grantTimeLimitedApproval(toolId, ttlMs ?? MAX_TTL_MS) };
        case 'context':
          return { result: await this.approval.grantContextApproval(toolId, REPO_CONTEXT) };
        case 'revoke':
          return { result: await this.approval.revokeApproval(toolId) };
        case 'clear':
          return { result: await this.approval.clearSessionApprovals() };
        default:
          return { result: await this.approval.queryApprovals({}) };
      }
    } catch (error) {
      return { error: error instanceof Error ? error.name : String(error) };
    }
  }
}

const ALICE: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' } };
const CALLER_IDS = { sessionId: 'session-alice', userId: 'alice' };

describe('this.approval revocation and the tool approval policy', () => {
  let storage: RootStorage;
  let server: DirectMcpServer;

  beforeEach(async () => {
    executed.length = 0;
    storage = createMemoryStorage();
    await storage.connect();

    @App({
      id: 'ops',
      name: 'Ops',
      plugins: [ApprovalPlugin.init({ storageInstance: storage, cleanupIntervalSeconds: 0 })],
      tools: [DeployTool, LimitedDeployTool, ApprovalsTool],
    })
    class OpsApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-revocation', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server.dispose();
  });

  async function approvals(
    op: Op,
    toolId: string,
    caller: DirectAuthContext = ALICE,
    ttlMs?: number,
  ): Promise<{ result?: unknown; error?: string }> {
    const response = await server.callTool('approvals', { op, toolId, ttlMs }, { authContext: caller });
    return response.structuredContent as { result?: unknown; error?: string };
  }

  async function run(name: string, caller: DirectAuthContext = ALICE): Promise<'ran' | 'refused'> {
    try {
      await server.callTool(name, {}, { authContext: caller });
      return 'ran';
    } catch (error) {
      if (error instanceof ApprovalRequiredError) return 'refused';
      throw error;
    }
  }

  /** Writes an approval the way an administrator or an external approval system would. */
  async function storeRecord(key: string, record: Partial<ApprovalRecord>): Promise<void> {
    const full = { state: ApprovalState.APPROVED, grantedAt: Date.now(), grantedBy: { source: 'admin' }, ...record };
    await storage.namespace('approval').set(key, JSON.stringify(full));
  }

  describe('revokeApproval()', () => {
    it('revokes a session approval', async () => {
      await approvals('session', DEPLOY_ID);
      expect(await run('deploy')).toBe('ran');

      expect((await approvals('revoke', DEPLOY_ID)).result).toBe(true);
      expect(await run('deploy')).toBe('refused');
    });

    it('revokes a user approval', async () => {
      await approvals('user', DEPLOY_ID);
      expect(await run('deploy')).toBe('ran');

      expect((await approvals('revoke', DEPLOY_ID)).result).toBe(true);
      expect(await run('deploy')).toBe('refused');
    });

    it('revokes a time-limited approval', async () => {
      await approvals('time', DEPLOY_ID);

      expect((await approvals('revoke', DEPLOY_ID)).result).toBe(true);
      expect(await run('deploy')).toBe('refused');
    });

    it('does not remove a recorded denial', async () => {
      await storeRecord(`${DEPLOY_ID}:user:alice`, { toolId: DEPLOY_ID, scope: ApprovalScope.USER, userId: 'alice' });
      await storeRecord(`${DEPLOY_ID}:session:session-alice`, {
        toolId: DEPLOY_ID,
        scope: ApprovalScope.SESSION,
        sessionId: 'session-alice',
        state: ApprovalState.DENIED,
      });

      await approvals('revoke', DEPLOY_ID);

      expect(await storage.namespace('approval').exists(`${DEPLOY_ID}:session:session-alice`)).toBe(true);
      expect(await run('deploy')).toBe('refused');
    });

    it("leaves another caller's approvals alone", async () => {
      const bob: DirectAuthContext = { sessionId: 'session-bob', user: { sub: 'bob' } };
      await approvals('session', DEPLOY_ID, bob);
      await approvals('user', DEPLOY_ID, bob);

      await approvals('revoke', DEPLOY_ID);

      expect(await run('deploy', bob)).toBe('ran');
    });
  });

  describe('clearSessionApprovals()', () => {
    it('does not clear a session whose id merely starts with the caller session id', async () => {
      const other: DirectAuthContext = { sessionId: 'session-alice-2', user: { sub: 'alice-2' } };
      await approvals('session', DEPLOY_ID, other);

      await approvals('clear', DEPLOY_ID);

      expect(await run('deploy', other)).toBe('ran');
    });
  });

  describe('grantTimeLimitedApproval()', () => {
    it('opens the gate until the approval expires', async () => {
      const grantedAt = Date.now();
      await approvals('time', DEPLOY_ID, ALICE, 1_000);

      expect(await run('deploy')).toBe('ran');

      jest.spyOn(Date, 'now').mockReturnValue(grantedAt + 5_000);
      expect(await run('deploy')).toBe('refused');
    });

    it('rejects a ttl that is not a positive number instead of storing a permanent approval', async () => {
      expect((await approvals('time', DEPLOY_ID, ALICE, 0)).error).toBe('ApprovalOperationError');
      expect(await run('deploy')).toBe('refused');
    });
  });

  describe('grantContextApproval()', () => {
    it('opens the gate for calls the server established in that context', async () => {
      await approvals('context', DEPLOY_ID);

      expect(await run('deploy', { ...ALICE, extra: { approvalContext: REPO_CONTEXT } })).toBe('ran');
    });

    it('does not open the gate outside that context', async () => {
      await approvals('context', DEPLOY_ID);

      expect(await run('deploy')).toBe('refused');
      expect(
        await run('deploy', { ...ALICE, extra: { approvalContext: { type: 'repository', identifier: 'acme/api' } } }),
      ).toBe('refused');
    });

    it('keeps a context approval granted before the session had a user once the user is known', async () => {
      const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
      await store.initialize();
      await createApprovalService(store, 'session-alice').grantContextApproval(DEPLOY_ID, REPO_CONTEXT);

      expect(await run('deploy', { ...ALICE, extra: { approvalContext: REPO_CONTEXT } })).toBe('ran');

      expect(await store.revokeApproval({ toolId: DEPLOY_ID, ...CALLER_IDS, context: REPO_CONTEXT })).toBe(true);
      expect(await run('deploy', { ...ALICE, extra: { approvalContext: REPO_CONTEXT } })).toBe('refused');
      await store.close();
    });

    it('lets a denial recorded for the context before the session had a user win', async () => {
      await approvals('context', DEPLOY_ID);
      await storeRecord(`${DEPLOY_ID}:session:session-alice:ctx:${REPO_CONTEXT.type}:${REPO_CONTEXT.identifier}`, {
        toolId: DEPLOY_ID,
        scope: ApprovalScope.CONTEXT_SPECIFIC,
        sessionId: 'session-alice',
        context: REPO_CONTEXT,
        state: ApprovalState.DENIED,
      });

      expect(await run('deploy', { ...ALICE, extra: { approvalContext: REPO_CONTEXT } })).toBe('refused');
    });
  });

  describe('allowedScopes', () => {
    it('refuses to grant a scope the tool does not allow', async () => {
      expect((await approvals('user', LIMITED_ID)).error).toBe('ApprovalScopeNotAllowedError');
      expect(await run('limited_deploy')).toBe('refused');
    });

    it('does not let an approval of a scope the tool does not allow open the gate', async () => {
      await storeRecord(`${LIMITED_ID}:user:alice`, { toolId: LIMITED_ID, scope: ApprovalScope.USER, userId: 'alice' });

      expect(await run('limited_deploy')).toBe('refused');
    });

    it('grants and honours an allowed scope', async () => {
      await approvals('session', LIMITED_ID);

      expect(await run('limited_deploy')).toBe('ran');
    });
  });

  describe('maxTtlMs', () => {
    it('refuses a time-limited grant longer than the tool allows', async () => {
      expect((await approvals('time', LIMITED_ID, ALICE, MAX_TTL_MS * 10)).error).toBe('ApprovalOperationError');
      expect(await run('limited_deploy')).toBe('refused');
    });

    it('limits a grant without a ttl to maxTtlMs', async () => {
      const grantedAt = Date.now();
      await approvals('session', LIMITED_ID);
      expect(await run('limited_deploy')).toBe('ran');

      jest.spyOn(Date, 'now').mockReturnValue(grantedAt + MAX_TTL_MS + 1_000);
      expect(await run('limited_deploy')).toBe('refused');
    });

    it('does not let an approval stored without an expiry outlive maxTtlMs', async () => {
      const grantedAt = Date.now();
      await storeRecord(`${LIMITED_ID}:session:session-alice`, {
        toolId: LIMITED_ID,
        scope: ApprovalScope.SESSION,
        sessionId: 'session-alice',
        grantedAt,
      });
      expect(await run('limited_deploy')).toBe('ran');

      jest.spyOn(Date, 'now').mockReturnValue(grantedAt + MAX_TTL_MS + 1_000);
      expect(await run('limited_deploy')).toBe('refused');
    });
  });

  describe('queryApprovals({})', () => {
    it("returns the caller's session and user approvals", async () => {
      await approvals('session', DEPLOY_ID);
      await approvals('user', DEPLOY_ID);

      const { result } = await approvals('query', DEPLOY_ID);
      const scopes = (result as ApprovalRecord[]).map((record) => record.scope).sort();

      expect(scopes).toEqual([ApprovalScope.SESSION, ApprovalScope.USER]);
    });

    it("does not return another caller's approvals", async () => {
      await approvals('session', DEPLOY_ID, { sessionId: 'session-bob', user: { sub: 'bob' } });

      expect((await approvals('query', DEPLOY_ID)).result).toEqual([]);
    });

    it("does not return another caller's approvals when the query names them", async () => {
      await approvals('session', DEPLOY_ID, { sessionId: 'session-bob', user: { sub: 'bob' } });
      await approvals('user', DEPLOY_ID, { sessionId: 'session-bob', user: { sub: 'bob' } });
      await approvals('user', DEPLOY_ID);

      const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
      await store.initialize();
      const alice = createApprovalService(store, CALLER_IDS.sessionId, CALLER_IDS.userId);

      expect(await alice.queryApprovals({ userId: 'bob' })).toEqual([]);
      expect(await alice.queryApprovals({ sessionId: 'session-bob' })).toEqual([]);
      expect(await alice.queryApprovals({ sessionId: 'session-bob', userId: 'bob' })).toEqual([]);
      expect((await alice.queryApprovals({ userId: 'alice' })).map((record) => record.userId)).toEqual(['alice']);
      await store.close();
    });
  });

  /**
   * A caller with a session and no user id (an anonymous HTTP caller): its session approval and its
   * time-limited approval used to share the `<tool>:session:<id>` key, so each grant replaced the other,
   * or a denial recorded for the session.
   */
  describe('a caller without a user id', () => {
    const ANON_SESSION = 'session-anon';
    let store: ApprovalStorageStore;
    let service: ApprovalService;

    beforeEach(async () => {
      store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
      await store.initialize();
      service = createApprovalService(store, ANON_SESSION);
    });

    afterEach(async () => {
      await store.close();
    });

    it('does not let a time-limited grant replace a denial recorded for the session', async () => {
      await storeRecord(`${DEPLOY_ID}:session:${ANON_SESSION}`, {
        toolId: DEPLOY_ID,
        scope: ApprovalScope.SESSION,
        sessionId: ANON_SESSION,
        state: ApprovalState.DENIED,
      });

      await service.grantTimeLimitedApproval(DEPLOY_ID, MAX_TTL_MS);

      expect(await service.isApproved(DEPLOY_ID)).toBe(false);
      expect((await store.getApproval(DEPLOY_ID, ANON_SESSION))?.state).toBe(ApprovalState.DENIED);
    });

    it('keeps its session approval when it also grants a time-limited one', async () => {
      const grantedAt = Date.now();
      await service.grantSessionApproval(DEPLOY_ID);
      await service.grantTimeLimitedApproval(DEPLOY_ID, 1_000);

      const scopes = (await store.getApprovals(DEPLOY_ID, ANON_SESSION)).map((record) => record.scope).sort();
      expect(scopes).toEqual([ApprovalScope.SESSION, ApprovalScope.TIME_LIMITED]);

      jest.spyOn(Date, 'now').mockReturnValue(grantedAt + 5_000);
      expect(await service.isApproved(DEPLOY_ID)).toBe(true);
    });

    it('keeps its time-limited approval when it also grants a session one', async () => {
      await service.grantTimeLimitedApproval(DEPLOY_ID, MAX_TTL_MS);
      await service.grantSessionApproval(DEPLOY_ID);

      const scopes = (await store.getApprovals(DEPLOY_ID, ANON_SESSION)).map((record) => record.scope).sort();
      expect(scopes).toEqual([ApprovalScope.SESSION, ApprovalScope.TIME_LIMITED]);
    });

    it('still reads a time-limited approval stored under the session key by 1.8.2', async () => {
      await storeRecord(`${DEPLOY_ID}:session:${ANON_SESSION}`, {
        toolId: DEPLOY_ID,
        scope: ApprovalScope.TIME_LIMITED,
        sessionId: ANON_SESSION,
        expiresAt: Date.now() + MAX_TTL_MS,
        ttlMs: MAX_TTL_MS,
      });

      expect(await service.isApproved(DEPLOY_ID)).toBe(true);
    });

    it('revokes and clears its time-limited approval', async () => {
      await service.grantTimeLimitedApproval(DEPLOY_ID, MAX_TTL_MS);
      expect(await service.revokeApproval(DEPLOY_ID)).toBe(true);
      expect(await service.isApproved(DEPLOY_ID)).toBe(false);

      await service.grantTimeLimitedApproval(DEPLOY_ID, MAX_TTL_MS);
      expect(await service.clearSessionApprovals()).toBe(1);
      expect(await service.isApproved(DEPLOY_ID)).toBe(false);
    });
  });
});
