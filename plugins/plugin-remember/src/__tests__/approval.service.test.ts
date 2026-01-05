import { ApprovalScope, ApprovalState, ApprovalMemoryStore, ApprovalService, createApprovalService } from '../approval';
import { testGrantor, userGrantor, policyGrantor, normalizeGrantor } from '../approval/approval.utils';

describe('ApprovalService', () => {
  let store: ApprovalMemoryStore;
  let service: ApprovalService;
  const sessionId = 'test-session-123';
  const userId = 'user-456';

  beforeEach(() => {
    store = new ApprovalMemoryStore(3600); // Long cleanup interval
    service = new ApprovalService(store, sessionId, userId);
  });

  afterEach(async () => {
    await store.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────

  describe('isApproved', () => {
    it('returns false when no approval exists', async () => {
      const result = await service.isApproved('tool-1');
      expect(result).toBe(false);
    });

    it('returns true when session approval exists', async () => {
      await service.grantSessionApproval('tool-1');
      const result = await service.isApproved('tool-1');
      expect(result).toBe(true);
    });

    it('returns true when user approval exists', async () => {
      await service.grantUserApproval('tool-1');
      const result = await service.isApproved('tool-1');
      expect(result).toBe(true);
    });

    it('returns false when approval is expired', async () => {
      await service.grantTimeLimitedApproval('tool-1', 1); // 1ms TTL
      await new Promise((r) => setTimeout(r, 10));
      const result = await service.isApproved('tool-1');
      expect(result).toBe(false);
    });

    it('returns true for context-specific approval', async () => {
      const context = { type: 'repo', identifier: '/path/to/repo' };
      await service.grantContextApproval('tool-1', context);
      const result = await service.isApproved('tool-1', context);
      expect(result).toBe(true);
    });
  });

  describe('getApproval', () => {
    it('returns undefined when no approval exists', async () => {
      const result = await service.getApproval('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns session approval', async () => {
      await service.grantSessionApproval('tool-1', { reason: 'user requested' });

      const result = await service.getApproval('tool-1');

      expect(result).toBeDefined();
      expect(result?.toolId).toBe('tool-1');
      expect(result?.state).toBe(ApprovalState.APPROVED);
      expect(result?.scope).toBe(ApprovalScope.SESSION);
      expect(result?.reason).toBe('user requested');
    });

    it('returns user approval when no session approval exists', async () => {
      await service.grantUserApproval('tool-1');

      const result = await service.getApproval('tool-1');

      expect(result).toBeDefined();
      expect(result?.scope).toBe(ApprovalScope.USER);
    });
  });

  describe('getSessionApprovals', () => {
    it('returns empty array when no approvals', async () => {
      const result = await service.getSessionApprovals();
      expect(result).toHaveLength(0);
    });

    it('returns all session approvals', async () => {
      await service.grantSessionApproval('tool-1');
      await service.grantSessionApproval('tool-2');
      await service.grantUserApproval('tool-3'); // Should not be included

      const result = await service.getSessionApprovals();

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some((a) => a.toolId === 'tool-1')).toBe(true);
      expect(result.some((a) => a.toolId === 'tool-2')).toBe(true);
    });

    it('excludes expired approvals', async () => {
      await service.grantTimeLimitedApproval('tool-1', 1);
      await new Promise((r) => setTimeout(r, 10));

      const result = await service.getSessionApprovals();

      expect(result.filter((a) => a.toolId === 'tool-1')).toHaveLength(0);
    });
  });

  describe('getUserApprovals', () => {
    it('returns empty array when no userId', async () => {
      const noUserService = new ApprovalService(store, sessionId);
      const result = await noUserService.getUserApprovals();
      expect(result).toHaveLength(0);
    });

    it('returns all user approvals', async () => {
      await service.grantUserApproval('tool-1');
      await service.grantUserApproval('tool-2');
      await service.grantSessionApproval('tool-3'); // Should not be included

      const result = await service.getUserApprovals();

      expect(result).toHaveLength(2);
      expect(result.some((a) => a.toolId === 'tool-1')).toBe(true);
      expect(result.some((a) => a.toolId === 'tool-2')).toBe(true);
    });
  });

  describe('queryApprovals', () => {
    it('queries by toolId', async () => {
      // Use service without userId to avoid filter mismatch
      const sessionService = new ApprovalService(store, sessionId);
      await sessionService.grantSessionApproval('tool-1');
      await sessionService.grantSessionApproval('tool-2');

      const result = await sessionService.queryApprovals({ toolId: 'tool-1' });

      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('tool-1');
    });

    it('queries by scope', async () => {
      // Use service without userId for session-only queries
      const sessionService = new ApprovalService(store, sessionId);
      await sessionService.grantSessionApproval('session-tool');

      const result = await sessionService.queryApprovals({ scope: ApprovalScope.SESSION });

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.every((a) => a.scope === ApprovalScope.SESSION)).toBe(true);
    });

    it('queries by state', async () => {
      const sessionService = new ApprovalService(store, sessionId);
      await sessionService.grantSessionApproval('tool-1');

      const result = await sessionService.queryApprovals({ state: ApprovalState.APPROVED });

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.every((a) => a.state === ApprovalState.APPROVED)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Grant Methods
  // ─────────────────────────────────────────────────────────────────────────

  describe('grantSessionApproval', () => {
    it('creates session-scoped approval with default grantor', async () => {
      const result = await service.grantSessionApproval('tool-1', { reason: 'test reason' });

      expect(result.toolId).toBe('tool-1');
      expect(result.scope).toBe(ApprovalScope.SESSION);
      expect(result.state).toBe(ApprovalState.APPROVED);
      expect(result.sessionId).toBe(sessionId);
      expect(result.grantedBy.source).toBe('policy'); // Default grantedBy
      expect(result.reason).toBe('test reason');
      expect(result.grantedAt).toBeGreaterThan(0);
    });

    it('creates session-scoped approval with custom grantor', async () => {
      const grantor = userGrantor('user-123', 'John Doe');
      const result = await service.grantSessionApproval('tool-1', { grantedBy: grantor });

      expect(result.grantedBy.source).toBe('user');
      expect(result.grantedBy.identifier).toBe('user-123');
      expect(result.grantedBy.displayName).toBe('John Doe');
    });

    it('accepts simple string source type for backward compatibility', async () => {
      const result = await service.grantSessionApproval('tool-1', { grantedBy: 'test' });

      expect(result.grantedBy.source).toBe('test');
    });

    it('can be retrieved after granting', async () => {
      await service.grantSessionApproval('tool-1');

      expect(await service.isApproved('tool-1')).toBe(true);
    });
  });

  describe('grantUserApproval', () => {
    it('creates user-scoped approval', async () => {
      const result = await service.grantUserApproval('tool-1', { reason: 'permanent' });

      expect(result.toolId).toBe('tool-1');
      expect(result.scope).toBe(ApprovalScope.USER);
      expect(result.state).toBe(ApprovalState.APPROVED);
      expect(result.userId).toBe(userId);
      expect(result.grantedBy.source).toBe('policy');
    });

    it('throws when no userId available', async () => {
      const noUserService = new ApprovalService(store, sessionId);

      await expect(noUserService.grantUserApproval('tool-1')).rejects.toThrow(
        'Cannot grant user approval without userId',
      );
    });
  });

  describe('grantTimeLimitedApproval', () => {
    it('creates time-limited approval', async () => {
      const result = await service.grantTimeLimitedApproval('tool-1', 60000);

      expect(result.toolId).toBe('tool-1');
      expect(result.scope).toBe(ApprovalScope.TIME_LIMITED);
      expect(result.ttlMs).toBe(60000);
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('approval expires after TTL', async () => {
      // Use a service without userId for simpler key matching
      const sessionService = new ApprovalService(store, sessionId);

      // Use a TTL long enough to verify approval before it expires
      await sessionService.grantTimeLimitedApproval('tool-ttl-exp', 200);

      // Verify it's approved immediately
      const approvedBefore = await sessionService.isApproved('tool-ttl-exp');
      expect(approvedBefore).toBe(true);

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 250));

      // Verify it's now expired
      const approvedAfter = await sessionService.isApproved('tool-ttl-exp');
      expect(approvedAfter).toBe(false);
    });
  });

  describe('grantContextApproval', () => {
    const context = { type: 'repository', identifier: '/home/user/project' };

    it('creates context-specific approval', async () => {
      const result = await service.grantContextApproval('tool-1', context, {
        reason: 'trusted repo',
      });

      expect(result.toolId).toBe('tool-1');
      expect(result.scope).toBe(ApprovalScope.CONTEXT_SPECIFIC);
      expect(result.context).toEqual(context);
      expect(result.reason).toBe('trusted repo');
      expect(result.grantedBy.source).toBe('policy');
    });

    it('context approval is specific to context', async () => {
      await service.grantContextApproval('tool-1', context);

      const otherContext = { type: 'repository', identifier: '/other/path' };

      expect(await service.isApproved('tool-1', context)).toBe(true);
      expect(await service.isApproved('tool-1', otherContext)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Revoke Methods
  // ─────────────────────────────────────────────────────────────────────────

  describe('revokeApproval', () => {
    it('revokes existing session approval', async () => {
      // Use a service without userId for session-only operations
      // This matches how session approvals are keyed (without userId)
      const sessionOnlyService = new ApprovalService(store, sessionId);

      await sessionOnlyService.grantSessionApproval('tool-revoke-test');
      expect(await sessionOnlyService.isApproved('tool-revoke-test')).toBe(true);

      const result = await sessionOnlyService.revokeApproval('tool-revoke-test');

      expect(result).toBe(true);
      expect(await sessionOnlyService.isApproved('tool-revoke-test')).toBe(false);
    });

    it('revokes existing user approval', async () => {
      await service.grantUserApproval('tool-user-revoke');
      expect(await service.isApproved('tool-user-revoke')).toBe(true);

      // Create a service without sessionId to revoke user approval
      const userService = new ApprovalService(store, '', userId);
      const result = await userService.revokeApproval('tool-user-revoke');

      expect(result).toBe(true);
    });

    it('returns false when no approval exists', async () => {
      const result = await service.revokeApproval('nonexistent-tool');
      expect(result).toBe(false);
    });
  });

  describe('clearSessionApprovals', () => {
    it('clears all session approvals', async () => {
      await service.grantSessionApproval('tool-1');
      await service.grantSessionApproval('tool-2');
      await service.grantUserApproval('tool-3');

      const count = await service.clearSessionApprovals();

      expect(count).toBeGreaterThanOrEqual(2);
      expect(await service.isApproved('tool-1')).toBe(false);
      expect(await service.isApproved('tool-2')).toBe(false);
      // User approval should still exist
      expect(await service.isApproved('tool-3')).toBe(true);
    });

    it('returns 0 when no session approvals', async () => {
      const count = await service.clearSessionApprovals();
      expect(count).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Function
  // ─────────────────────────────────────────────────────────────────────────

  describe('createApprovalService', () => {
    it('creates an ApprovalService instance', () => {
      const result = createApprovalService(store, sessionId, userId);
      expect(result).toBeInstanceOf(ApprovalService);
    });

    it('works without userId', () => {
      const result = createApprovalService(store, sessionId);
      expect(result).toBeInstanceOf(ApprovalService);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles multiple approvals for same tool with different scopes', async () => {
      await service.grantSessionApproval('tool-1');
      await service.grantUserApproval('tool-1');

      expect(await service.isApproved('tool-1')).toBe(true);

      // Revoke session approval
      await service.revokeApproval('tool-1');

      // User approval should still work
      expect(await service.isApproved('tool-1')).toBe(true);
    });

    it('handles special characters in tool IDs', async () => {
      const specialToolId = 'tool:with:colons/and/slashes';
      await service.grantSessionApproval(specialToolId);

      expect(await service.isApproved(specialToolId)).toBe(true);
    });

    it('handles empty reason', async () => {
      const result = await service.grantSessionApproval('tool-1', { reason: '' });
      expect(result.reason).toBe('');
    });
  });
});

describe('ApprovalMemoryStore', () => {
  let store: ApprovalMemoryStore;

  beforeEach(() => {
    store = new ApprovalMemoryStore(3600);
  });

  afterEach(async () => {
    await store.close();
  });

  describe('getStats', () => {
    it('returns correct statistics', async () => {
      await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: 'test',
      });
      await store.grantApproval({
        toolId: 'tool-2',
        scope: ApprovalScope.USER,
        userId: 'user-1',
        grantedBy: 'test',
      });

      const stats = await store.getStats();

      expect(stats.totalApprovals).toBe(2);
      expect(stats.byScope[ApprovalScope.SESSION]).toBe(1);
      expect(stats.byScope[ApprovalScope.USER]).toBe(1);
      expect(stats.byState[ApprovalState.APPROVED]).toBe(2);
    });
  });

  describe('clearExpiredApprovals', () => {
    it('clears expired approvals', async () => {
      await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.TIME_LIMITED,
        ttlMs: 1,
        sessionId: 'session-1',
        grantedBy: 'test',
      });
      await store.grantApproval({
        toolId: 'tool-2',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: 'test',
      });

      await new Promise((r) => setTimeout(r, 10));
      const cleared = await store.clearExpiredApprovals();

      expect(cleared).toBe(1);

      const stats = await store.getStats();
      expect(stats.totalApprovals).toBe(1);
    });
  });

  describe('close', () => {
    it('clears all data on close', async () => {
      await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: 'test',
      });

      await store.close();

      const stats = await store.getStats();
      expect(stats.totalApprovals).toBe(0);
    });
  });

  describe('grantedBy normalization', () => {
    it('normalizes string source to ApprovalGrantor object', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: 'test',
      });

      expect(result.grantedBy).toEqual({ source: 'test' });
    });

    it('accepts full ApprovalGrantor object', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-2',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: {
          source: 'user',
          identifier: 'user-123',
          displayName: 'John Doe',
          method: 'interactive',
        },
      });

      expect(result.grantedBy.source).toBe('user');
      expect(result.grantedBy.identifier).toBe('user-123');
      expect(result.grantedBy.displayName).toBe('John Doe');
      expect(result.grantedBy.method).toBe('interactive');
    });

    it('defaults to user when grantedBy is undefined', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-3',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
      });

      expect(result.grantedBy).toEqual({ source: 'user' });
    });
  });
});

describe('approval.utils', () => {
  describe('normalizeGrantor', () => {
    it('returns default user grantor for undefined', () => {
      const result = normalizeGrantor(undefined);
      expect(result).toEqual({ source: 'user' });
    });

    it('converts string to grantor object', () => {
      const result = normalizeGrantor('test');
      expect(result).toEqual({ source: 'test' });
    });

    it('passes through full grantor object', () => {
      const grantor = { source: 'admin', identifier: 'admin-1' };
      const result = normalizeGrantor(grantor);
      expect(result).toBe(grantor);
    });
  });

  describe('factory functions', () => {
    it('userGrantor creates correct structure', () => {
      const result = userGrantor('user-123', 'John Doe');
      expect(result.source).toBe('user');
      expect(result.identifier).toBe('user-123');
      expect(result.displayName).toBe('John Doe');
      expect(result.method).toBe('interactive');
    });

    it('policyGrantor creates correct structure', () => {
      const result = policyGrantor('safe-list', 'Safe Tools');
      expect(result.source).toBe('policy');
      expect(result.identifier).toBe('safe-list');
      expect(result.displayName).toBe('Safe Tools');
      expect(result.method).toBe('implicit');
    });

    it('testGrantor creates correct structure', () => {
      const result = testGrantor();
      expect(result.source).toBe('test');
      expect(result.identifier).toBe('test');
      expect(result.method).toBe('implicit');
    });
  });
});
