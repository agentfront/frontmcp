// file: plugins/plugin-approval/src/__tests__/approval-storage.store.test.ts

import 'reflect-metadata';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    createStorage: jest.fn().mockResolvedValue({
      namespace: jest.fn().mockReturnValue({
        set: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        keys: jest.fn(),
        mget: jest.fn(),
        mdelete: jest.fn(),
        root: { disconnect: jest.fn() },
      }),
    }),
    createMemoryStorage: jest.fn().mockReturnValue({
      namespace: jest.fn().mockReturnValue({
        set: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        keys: jest.fn(),
        mget: jest.fn(),
        mdelete: jest.fn(),
        root: { disconnect: jest.fn() },
      }),
    }),
  };
});

import { ApprovalStorageStore, createApprovalMemoryStore } from '../stores/approval-storage.store';
import { ApprovalScope, ApprovalState, type ApprovalRecord } from '../types';
import { createStorage, createMemoryStorage } from '@frontmcp/utils';

describe('ApprovalStorageStore', () => {
  let store: ApprovalStorageStore;
  let mockStorage: {
    set: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
    keys: jest.Mock;
    mget: jest.Mock;
    mdelete: jest.Mock;
    root: { disconnect: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockStorage = {
      set: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      mget: jest.fn().mockResolvedValue([]),
      mdelete: jest.fn().mockResolvedValue(0),
      root: { disconnect: jest.fn() },
    };

    const mockRootStorage = {
      namespace: jest.fn().mockReturnValue(mockStorage),
    };

    (createStorage as jest.Mock).mockResolvedValue(mockRootStorage);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create store with default options', () => {
      store = new ApprovalStorageStore();
      expect(store).toBeDefined();
    });

    it('should create store with custom options', () => {
      store = new ApprovalStorageStore({
        namespace: 'custom-approval',
        cleanupIntervalSeconds: 120,
      });
      expect(store).toBeDefined();
    });

    it('should create store with storage instance', () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(mockStorage),
      };
      store = new ApprovalStorageStore({
        storageInstance: mockInstance as any,
      });
      expect(store).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with auto storage config', async () => {
      store = new ApprovalStorageStore();
      await store.initialize();

      expect(createStorage).toHaveBeenCalledWith({ type: 'auto' });
    });

    it('should initialize with storage instance', async () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(mockStorage),
      };
      store = new ApprovalStorageStore({
        storageInstance: mockInstance as any,
      });

      await store.initialize();

      expect(mockInstance.namespace).toHaveBeenCalledWith('approval');
    });

    it('should not reinitialize if already initialized', async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
      await store.initialize();

      expect(createStorage).toHaveBeenCalledTimes(1);
    });

    it('should set up cleanup interval', async () => {
      store = new ApprovalStorageStore({ cleanupIntervalSeconds: 60 });
      await store.initialize();

      // Advance timers to trigger cleanup
      jest.advanceTimersByTime(60000);

      expect(mockStorage.keys).toHaveBeenCalled();
    });

    it('should not set up cleanup interval if disabled', async () => {
      store = new ApprovalStorageStore({ cleanupIntervalSeconds: 0 });
      await store.initialize();

      // Keys should not be called from cleanup
      mockStorage.keys.mockClear();
      jest.advanceTimersByTime(60000);

      expect(mockStorage.keys).not.toHaveBeenCalled();
    });
  });

  describe('grantApproval', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();

      await expect(
        uninitStore.grantApproval({
          toolId: 'tool-1',
          scope: ApprovalScope.SESSION,
          sessionId: 'session-1',
          grantedBy: 'user',
        }),
      ).rejects.toThrow('not initialized');
    });

    it('should grant session approval', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: 'user',
      });

      expect(result.toolId).toBe('tool-1');
      expect(result.scope).toBe(ApprovalScope.SESSION);
      expect(result.state).toBe(ApprovalState.APPROVED);
      expect(mockStorage.set).toHaveBeenCalled();
    });

    it('should grant user approval', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.USER,
        userId: 'user-1',
        grantedBy: 'admin',
      });

      expect(result.scope).toBe(ApprovalScope.USER);
      expect(result.userId).toBe('user-1');
    });

    it('should grant time-limited approval', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.TIME_LIMITED,
        sessionId: 'session-1',
        ttlMs: 60000,
        grantedBy: 'policy',
      });

      expect(result.ttlMs).toBe(60000);
      expect(result.expiresAt).toBeDefined();
      expect(mockStorage.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), { ttlSeconds: 60 });
    });

    it('should grant context-specific approval', async () => {
      const context = { type: 'file', identifier: '/path/to/file.txt' };
      const result = await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.CONTEXT_SPECIFIC,
        sessionId: 'session-1',
        context,
        grantedBy: 'user',
      });

      expect(result.context).toEqual(context);
    });

    it('should include reason and metadata', async () => {
      const result = await store.grantApproval({
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: 'user',
        reason: 'User approved via UI',
        metadata: { source: 'dashboard' },
      });

      expect(result.reason).toBe('User approved via UI');
      expect(result.metadata).toEqual({ source: 'dashboard' });
    });
  });

  describe('getApproval', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.getApproval('tool-1', 'session-1')).rejects.toThrow('not initialized');
    });

    it('should return session approval', async () => {
      const record = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(record));

      const result = await store.getApproval('tool-1', 'session-1');

      expect(result?.toolId).toBe('tool-1');
    });

    it('should return user approval if session not found', async () => {
      const userRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.USER,
        state: ApprovalState.APPROVED,
        userId: 'user-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'admin' },
      };
      mockStorage.get
        .mockResolvedValueOnce(null) // session lookup
        .mockResolvedValueOnce(JSON.stringify(userRecord)); // user lookup

      const result = await store.getApproval('tool-1', 'session-1', 'user-1');

      expect(result?.scope).toBe(ApprovalScope.USER);
    });

    it('should return undefined if not found', async () => {
      mockStorage.get.mockResolvedValue(null);

      const result = await store.getApproval('tool-1', 'session-1');

      expect(result).toBeUndefined();
    });

    it('should skip expired approvals', async () => {
      const expiredRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now() - 60000,
        expiresAt: Date.now() - 1000, // Expired
        grantedBy: { source: 'user' },
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(expiredRecord));

      const result = await store.getApproval('tool-1', 'session-1');

      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid JSON', async () => {
      mockStorage.get.mockResolvedValue('invalid-json{');

      const result = await store.getApproval('tool-1', 'session-1');

      expect(result).toBeUndefined();
    });
  });

  describe('isApproved', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.isApproved('tool-1', 'session-1')).rejects.toThrow('not initialized');
    });

    it('should return true for session approval', async () => {
      const record: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(record));

      const result = await store.isApproved('tool-1', 'session-1');

      expect(result).toBe(true);
    });

    it('should return true for user approval', async () => {
      const userRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.USER,
        state: ApprovalState.APPROVED,
        userId: 'user-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'admin' },
      };
      mockStorage.get
        .mockResolvedValueOnce(null) // session lookup
        .mockResolvedValueOnce(JSON.stringify(userRecord)); // user lookup

      const result = await store.isApproved('tool-1', 'session-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should return true for context approval', async () => {
      const contextRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.CONTEXT_SPECIFIC,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        context: { type: 'file', identifier: '/path/file.txt' },
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(contextRecord));

      const result = await store.isApproved('tool-1', 'session-1', undefined, {
        type: 'file',
        identifier: '/path/file.txt',
      });

      expect(result).toBe(true);
    });

    it('should return false if not approved', async () => {
      mockStorage.get.mockResolvedValue(null);

      const result = await store.isApproved('tool-1', 'session-1');

      expect(result).toBe(false);
    });

    it('should return false if expired', async () => {
      const expiredRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now() - 60000,
        expiresAt: Date.now() - 1000,
        grantedBy: { source: 'user' },
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(expiredRecord));

      const result = await store.isApproved('tool-1', 'session-1');

      expect(result).toBe(false);
    });

    it('should return false if state is not APPROVED', async () => {
      const pendingRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.PENDING,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(pendingRecord));

      const result = await store.isApproved('tool-1', 'session-1');

      expect(result).toBe(false);
    });
  });

  describe('revokeApproval', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.revokeApproval({ toolId: 'tool-1', sessionId: 'session-1' })).rejects.toThrow(
        'not initialized',
      );
    });

    it('should revoke existing approval', async () => {
      mockStorage.exists.mockResolvedValue(true);

      const result = await store.revokeApproval({
        toolId: 'tool-1',
        sessionId: 'session-1',
      });

      expect(result).toBe(true);
      expect(mockStorage.delete).toHaveBeenCalled();
    });

    it('should return false if not exists', async () => {
      mockStorage.exists.mockResolvedValue(false);

      const result = await store.revokeApproval({
        toolId: 'tool-1',
        sessionId: 'session-1',
      });

      expect(result).toBe(false);
    });
  });

  describe('queryApprovals', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.queryApprovals({})).rejects.toThrow('not initialized');
    });

    it('should return matching approvals', async () => {
      const record: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(record)]);

      const results = await store.queryApprovals({
        sessionId: 'session-1',
      });

      expect(results).toHaveLength(1);
      expect(results[0].toolId).toBe('tool-1');
    });

    it('should filter by toolId', async () => {
      const record: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(record)]);

      const results = await store.queryApprovals({
        toolId: 'tool-2', // Different toolId
      });

      expect(results).toHaveLength(0);
    });

    it('should filter by scope', async () => {
      const record: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(record)]);

      const results = await store.queryApprovals({
        scope: ApprovalScope.USER, // Different scope
      });

      expect(results).toHaveLength(0);
    });

    it('should skip expired unless includeExpired', async () => {
      const expiredRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now() - 60000,
        expiresAt: Date.now() - 1000,
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(expiredRecord)]);

      const results = await store.queryApprovals({});

      expect(results).toHaveLength(0);
    });

    it('should include expired if requested', async () => {
      const expiredRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now() - 60000,
        expiresAt: Date.now() - 1000,
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(expiredRecord)]);

      const results = await store.queryApprovals({
        includeExpired: true,
      });

      expect(results).toHaveLength(1);
    });
  });

  describe('clearSessionApprovals', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.clearSessionApprovals('session-1')).rejects.toThrow('not initialized');
    });

    it('should delete session approvals', async () => {
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1', 'tool-2:session:session-1']);
      mockStorage.mdelete.mockResolvedValue(2);

      const count = await store.clearSessionApprovals('session-1');

      expect(count).toBe(2);
      expect(mockStorage.mdelete).toHaveBeenCalledWith(['tool-1:session:session-1', 'tool-2:session:session-1']);
    });

    it('should return 0 if no keys found', async () => {
      mockStorage.keys.mockResolvedValue([]);

      const count = await store.clearSessionApprovals('session-1');

      expect(count).toBe(0);
      expect(mockStorage.mdelete).not.toHaveBeenCalled();
    });

    it('should escape glob metacharacters in sessionId', async () => {
      mockStorage.keys.mockResolvedValue([]);

      await store.clearSessionApprovals('session*[test]?');

      expect(mockStorage.keys).toHaveBeenCalledWith(expect.stringContaining('session\\*\\[test\\]\\?'));
    });
  });

  describe('clearExpiredApprovals', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.clearExpiredApprovals()).rejects.toThrow('not initialized');
    });

    it('should delete expired approvals', async () => {
      const expiredRecord: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now() - 60000,
        expiresAt: Date.now() - 1000,
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(expiredRecord)]);
      mockStorage.mdelete.mockResolvedValue(1);

      const count = await store.clearExpiredApprovals();

      expect(count).toBe(1);
    });

    it('should not delete non-expired approvals', async () => {
      const record: ApprovalRecord = {
        toolId: 'tool-1',
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        sessionId: 'session-1',
        grantedAt: Date.now(),
        expiresAt: Date.now() + 60000, // Not expired
        grantedBy: { source: 'user' },
      };
      mockStorage.keys.mockResolvedValue(['tool-1:session:session-1']);
      mockStorage.mget.mockResolvedValue([JSON.stringify(record)]);

      const count = await store.clearExpiredApprovals();

      expect(count).toBe(0);
      expect(mockStorage.mdelete).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      store = new ApprovalStorageStore();
      await store.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitStore = new ApprovalStorageStore();
      await expect(uninitStore.getStats()).rejects.toThrow('not initialized');
    });

    it('should return approval statistics', async () => {
      const records = [
        {
          toolId: 'tool-1',
          scope: ApprovalScope.SESSION,
          state: ApprovalState.APPROVED,
          grantedAt: Date.now(),
          grantedBy: { source: 'user' },
        },
        {
          toolId: 'tool-2',
          scope: ApprovalScope.USER,
          state: ApprovalState.APPROVED,
          grantedAt: Date.now(),
          grantedBy: { source: 'admin' },
        },
        {
          toolId: 'tool-3',
          scope: ApprovalScope.SESSION,
          state: ApprovalState.PENDING,
          grantedAt: Date.now(),
          grantedBy: { source: 'user' },
        },
      ];
      mockStorage.keys.mockResolvedValue(['key1', 'key2', 'key3']);
      mockStorage.mget.mockResolvedValue(records.map((r) => JSON.stringify(r)));

      const stats = await store.getStats();

      expect(stats.totalApprovals).toBe(3);
      expect(stats.byScope[ApprovalScope.SESSION]).toBe(2);
      expect(stats.byScope[ApprovalScope.USER]).toBe(1);
      expect(stats.byState[ApprovalState.APPROVED]).toBe(2);
      expect(stats.byState[ApprovalState.PENDING]).toBe(1);
    });
  });

  describe('close', () => {
    it('should disconnect owned storage', async () => {
      store = new ApprovalStorageStore();
      await store.initialize();

      await store.close();

      expect(mockStorage.root.disconnect).toHaveBeenCalled();
    });

    it('should not disconnect external storage', async () => {
      const externalStorage = {
        namespace: jest.fn().mockReturnValue(mockStorage),
      };
      store = new ApprovalStorageStore({
        storageInstance: externalStorage as any,
      });
      await store.initialize();

      await store.close();

      expect(mockStorage.root.disconnect).not.toHaveBeenCalled();
    });

    it('should clear cleanup interval', async () => {
      store = new ApprovalStorageStore({ cleanupIntervalSeconds: 60 });
      await store.initialize();

      await store.close();

      // Verify interval is cleared by advancing time
      mockStorage.keys.mockClear();
      jest.advanceTimersByTime(120000);
      expect(mockStorage.keys).not.toHaveBeenCalled();
    });
  });
});

describe('createApprovalMemoryStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create store with memory storage', () => {
    const store = createApprovalMemoryStore();
    expect(store).toBeInstanceOf(ApprovalStorageStore);
    expect(createMemoryStorage).toHaveBeenCalled();
  });

  it('should pass options to store', () => {
    const store = createApprovalMemoryStore({
      namespace: 'custom',
      cleanupIntervalSeconds: 120,
    });
    expect(store).toBeInstanceOf(ApprovalStorageStore);
  });
});
