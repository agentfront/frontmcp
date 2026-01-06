// file: plugins/plugin-approval/src/__tests__/approval.service.test.ts

import 'reflect-metadata';
import { ApprovalService, createApprovalService } from '../services/approval.service';
import { ApprovalScope, ApprovalState } from '../types';
import type { ApprovalStore } from '../stores/approval-store.interface';
import type { ApprovalRecord } from '../types';

describe('ApprovalService', () => {
  let mockStore: jest.Mocked<ApprovalStore>;
  let service: ApprovalService;
  const sessionId = 'test-session-123';
  const userId = 'test-user-456';

  const mockApprovalRecord: ApprovalRecord = {
    id: 'approval-1',
    toolId: 'test-tool',
    scope: ApprovalScope.SESSION,
    state: ApprovalState.APPROVED,
    sessionId,
    createdAt: Date.now(),
    grantedAt: Date.now(),
    grantedBy: 'user',
  };

  beforeEach(() => {
    mockStore = {
      isApproved: jest.fn(),
      getApproval: jest.fn(),
      queryApprovals: jest.fn(),
      grantApproval: jest.fn(),
      revokeApproval: jest.fn(),
      clearSessionApprovals: jest.fn(),
      initialize: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<ApprovalStore>;

    service = new ApprovalService(mockStore, sessionId, userId);
  });

  describe('constructor', () => {
    it('should create service with store, sessionId, and userId', () => {
      expect(service).toBeDefined();
    });

    it('should create service without userId', () => {
      const serviceWithoutUser = new ApprovalService(mockStore, sessionId);
      expect(serviceWithoutUser).toBeDefined();
    });
  });

  describe('isApproved', () => {
    it('should check if tool is approved', async () => {
      mockStore.isApproved.mockResolvedValue(true);

      const result = await service.isApproved('my-tool');

      expect(result).toBe(true);
      expect(mockStore.isApproved).toHaveBeenCalledWith('my-tool', sessionId, userId, undefined);
    });

    it('should pass context to store', async () => {
      mockStore.isApproved.mockResolvedValue(false);
      const context = { resource: 'file.txt' };

      const result = await service.isApproved('my-tool', context);

      expect(result).toBe(false);
      expect(mockStore.isApproved).toHaveBeenCalledWith('my-tool', sessionId, userId, context);
    });
  });

  describe('getApproval', () => {
    it('should get approval record', async () => {
      mockStore.getApproval.mockResolvedValue(mockApprovalRecord);

      const result = await service.getApproval('my-tool');

      expect(result).toEqual(mockApprovalRecord);
      expect(mockStore.getApproval).toHaveBeenCalledWith('my-tool', sessionId, userId);
    });

    it('should return undefined when not found', async () => {
      mockStore.getApproval.mockResolvedValue(undefined);

      const result = await service.getApproval('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getSessionApprovals', () => {
    it('should get all session approvals', async () => {
      mockStore.queryApprovals.mockResolvedValue([mockApprovalRecord]);

      const result = await service.getSessionApprovals();

      expect(result).toEqual([mockApprovalRecord]);
      expect(mockStore.queryApprovals).toHaveBeenCalledWith({
        sessionId,
        states: [ApprovalState.APPROVED],
        includeExpired: false,
      });
    });
  });

  describe('getUserApprovals', () => {
    it('should get all user approvals', async () => {
      const userApproval = { ...mockApprovalRecord, scope: ApprovalScope.USER };
      mockStore.queryApprovals.mockResolvedValue([userApproval]);

      const result = await service.getUserApprovals();

      expect(result).toEqual([userApproval]);
      expect(mockStore.queryApprovals).toHaveBeenCalledWith({
        userId,
        scope: ApprovalScope.USER,
        states: [ApprovalState.APPROVED],
        includeExpired: false,
      });
    });

    it('should return empty array if no userId', async () => {
      const serviceNoUser = new ApprovalService(mockStore, sessionId);

      const result = await serviceNoUser.getUserApprovals();

      expect(result).toEqual([]);
      expect(mockStore.queryApprovals).not.toHaveBeenCalled();
    });
  });

  describe('queryApprovals', () => {
    it('should query approvals with custom filters', async () => {
      mockStore.queryApprovals.mockResolvedValue([mockApprovalRecord]);

      const result = await service.queryApprovals({
        toolId: 'specific-tool',
        states: [ApprovalState.APPROVED, ApprovalState.PENDING],
      });

      expect(result).toEqual([mockApprovalRecord]);
      expect(mockStore.queryApprovals).toHaveBeenCalledWith({
        toolId: 'specific-tool',
        states: [ApprovalState.APPROVED, ApprovalState.PENDING],
        sessionId,
        userId,
      });
    });

    it('should allow overriding sessionId and userId', async () => {
      mockStore.queryApprovals.mockResolvedValue([]);

      await service.queryApprovals({
        sessionId: 'other-session',
        userId: 'other-user',
      });

      expect(mockStore.queryApprovals).toHaveBeenCalledWith({
        sessionId: 'other-session',
        userId: 'other-user',
      });
    });
  });

  describe('grantSessionApproval', () => {
    it('should grant session approval with defaults', async () => {
      mockStore.grantApproval.mockResolvedValue(mockApprovalRecord);

      const result = await service.grantSessionApproval('my-tool');

      expect(result).toEqual(mockApprovalRecord);
      expect(mockStore.grantApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        scope: ApprovalScope.SESSION,
        sessionId,
        grantedBy: 'policy',
        reason: undefined,
        metadata: undefined,
      });
    });

    it('should grant session approval with options', async () => {
      mockStore.grantApproval.mockResolvedValue(mockApprovalRecord);

      const result = await service.grantSessionApproval('my-tool', {
        grantedBy: 'user',
        reason: 'User approved',
        metadata: { source: 'ui' },
      });

      expect(result).toEqual(mockApprovalRecord);
      expect(mockStore.grantApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        scope: ApprovalScope.SESSION,
        sessionId,
        grantedBy: 'user',
        reason: 'User approved',
        metadata: { source: 'ui' },
      });
    });
  });

  describe('grantUserApproval', () => {
    it('should grant user approval', async () => {
      const userApproval = { ...mockApprovalRecord, scope: ApprovalScope.USER };
      mockStore.grantApproval.mockResolvedValue(userApproval);

      const result = await service.grantUserApproval('my-tool');

      expect(result).toEqual(userApproval);
      expect(mockStore.grantApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        scope: ApprovalScope.USER,
        userId,
        grantedBy: 'policy',
        reason: undefined,
        metadata: undefined,
      });
    });

    it('should throw if no userId', async () => {
      const serviceNoUser = new ApprovalService(mockStore, sessionId);

      await expect(serviceNoUser.grantUserApproval('my-tool')).rejects.toThrow(
        'Cannot grant user approval without userId',
      );
    });
  });

  describe('grantTimeLimitedApproval', () => {
    it('should grant time-limited approval', async () => {
      const timeLimitedApproval = { ...mockApprovalRecord, scope: ApprovalScope.TIME_LIMITED };
      mockStore.grantApproval.mockResolvedValue(timeLimitedApproval);

      const result = await service.grantTimeLimitedApproval('my-tool', 60000);

      expect(result).toEqual(timeLimitedApproval);
      expect(mockStore.grantApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        scope: ApprovalScope.TIME_LIMITED,
        ttlMs: 60000,
        sessionId,
        userId,
        grantedBy: 'policy',
        reason: undefined,
        metadata: undefined,
      });
    });
  });

  describe('grantContextApproval', () => {
    it('should grant context-specific approval', async () => {
      const contextApproval = { ...mockApprovalRecord, scope: ApprovalScope.CONTEXT_SPECIFIC };
      mockStore.grantApproval.mockResolvedValue(contextApproval);
      const context = { resource: '/path/to/file' };

      const result = await service.grantContextApproval('my-tool', context);

      expect(result).toEqual(contextApproval);
      expect(mockStore.grantApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        scope: ApprovalScope.CONTEXT_SPECIFIC,
        context,
        sessionId,
        userId,
        grantedBy: 'policy',
        reason: undefined,
        metadata: undefined,
      });
    });
  });

  describe('revokeApproval', () => {
    it('should revoke approval with defaults', async () => {
      mockStore.revokeApproval.mockResolvedValue(true);

      const result = await service.revokeApproval('my-tool');

      expect(result).toBe(true);
      expect(mockStore.revokeApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        sessionId,
        userId,
        revokedBy: 'policy',
        reason: undefined,
      });
    });

    it('should revoke approval with options', async () => {
      mockStore.revokeApproval.mockResolvedValue(true);

      const result = await service.revokeApproval('my-tool', {
        revokedBy: 'admin',
        reason: 'Security concern',
      });

      expect(result).toBe(true);
      expect(mockStore.revokeApproval).toHaveBeenCalledWith({
        toolId: 'my-tool',
        sessionId,
        userId,
        revokedBy: 'admin',
        reason: 'Security concern',
      });
    });
  });

  describe('clearSessionApprovals', () => {
    it('should clear all session approvals', async () => {
      mockStore.clearSessionApprovals.mockResolvedValue(5);

      const result = await service.clearSessionApprovals();

      expect(result).toBe(5);
      expect(mockStore.clearSessionApprovals).toHaveBeenCalledWith(sessionId);
    });
  });
});

describe('createApprovalService', () => {
  it('should create ApprovalService instance', () => {
    const mockStore = {} as ApprovalStore;
    const service = createApprovalService(mockStore, 'session-1', 'user-1');

    expect(service).toBeInstanceOf(ApprovalService);
  });

  it('should create ApprovalService without userId', () => {
    const mockStore = {} as ApprovalStore;
    const service = createApprovalService(mockStore, 'session-1');

    expect(service).toBeInstanceOf(ApprovalService);
  });
});
