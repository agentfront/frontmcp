// file: plugins/plugin-approval/src/__tests__/challenge.service.test.ts

import 'reflect-metadata';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    generatePkcePair: jest.fn().mockReturnValue({
      codeVerifier: 'test-verifier-123',
      codeChallenge: 'test-challenge-456',
    }),
    generateCodeChallenge: jest.fn().mockReturnValue('test-challenge-456'),
    createStorage: jest.fn().mockResolvedValue({
      namespace: jest.fn().mockReturnValue({
        set: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        root: { disconnect: jest.fn() },
      }),
    }),
    createMemoryStorage: jest.fn().mockReturnValue({
      namespace: jest.fn().mockReturnValue({
        set: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        root: { disconnect: jest.fn() },
      }),
    }),
  };
});

import { ChallengeService, createMemoryChallengeService } from '../services/challenge.service';
import { ChallengeValidationError } from '../approval';
import { createStorage, createMemoryStorage, generateCodeChallenge } from '@frontmcp/utils';

describe('ChallengeService', () => {
  let service: ChallengeService;
  let mockStorage: {
    set: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
    root: { disconnect: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockStorage = {
      set: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      root: { disconnect: jest.fn() },
    };

    const mockRootStorage = {
      namespace: jest.fn().mockReturnValue(mockStorage),
    };

    (createStorage as jest.Mock).mockResolvedValue(mockRootStorage);
  });

  describe('constructor', () => {
    it('should create service with default options', () => {
      service = new ChallengeService();
      expect(service).toBeDefined();
    });

    it('should create service with custom options', () => {
      service = new ChallengeService({
        namespace: 'custom:challenge',
        defaultTtlSeconds: 600,
      });
      expect(service).toBeDefined();
    });

    it('should create service with storage instance', () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(mockStorage),
      };
      service = new ChallengeService({
        storageInstance: mockInstance as any,
      });
      expect(service).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with auto storage config', async () => {
      service = new ChallengeService();
      await service.initialize();

      expect(createStorage).toHaveBeenCalledWith({ type: 'auto' });
    });

    it('should initialize with storage instance', async () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(mockStorage),
      };
      service = new ChallengeService({
        storageInstance: mockInstance as any,
      });

      await service.initialize();

      expect(mockInstance.namespace).toHaveBeenCalledWith('approval:challenge');
    });

    it('should not reinitialize if already initialized', async () => {
      service = new ChallengeService();
      await service.initialize();
      await service.initialize();

      expect(createStorage).toHaveBeenCalledTimes(1);
    });
  });

  describe('createChallenge', () => {
    beforeEach(async () => {
      service = new ChallengeService();
      await service.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitService = new ChallengeService();

      await expect(
        uninitService.createChallenge({
          toolId: 'tool-1',
          sessionId: 'session-1',
          requestedScope: 'session',
          requestInfo: { toolName: 'Test Tool' },
        }),
      ).rejects.toThrow('not initialized');
    });

    it('should create challenge with PKCE pair', async () => {
      const result = await service.createChallenge({
        toolId: 'tool-1',
        sessionId: 'session-1',
        requestedScope: 'session',
        requestInfo: { toolName: 'Test Tool' },
      });

      expect(result.codeVerifier).toBe('test-verifier-123');
      expect(result.codeChallenge).toBe('test-challenge-456');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
      expect(mockStorage.set).toHaveBeenCalled();
    });

    it('should use custom TTL', async () => {
      const result = await service.createChallenge({
        toolId: 'tool-1',
        sessionId: 'session-1',
        requestedScope: 'session',
        requestInfo: { toolName: 'Test Tool' },
        ttlSeconds: 600,
      });

      expect(mockStorage.set).toHaveBeenCalledWith('test-challenge-456', expect.any(String), { ttlSeconds: 600 });
    });

    it('should include all request info in record', async () => {
      await service.createChallenge({
        toolId: 'tool-1',
        sessionId: 'session-1',
        userId: 'user-1',
        requestedScope: 'user',
        requestInfo: {
          toolName: 'Test Tool',
          category: 'data',
          riskLevel: 'medium',
          customMessage: 'Custom approval message',
        },
      });

      expect(mockStorage.set).toHaveBeenCalledWith(
        'test-challenge-456',
        expect.stringContaining('"toolId":"tool-1"'),
        expect.any(Object),
      );
    });
  });

  describe('verifyAndConsume', () => {
    beforeEach(async () => {
      service = new ChallengeService();
      await service.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitService = new ChallengeService();

      await expect(uninitService.verifyAndConsume('verifier')).rejects.toThrow('not initialized');
    });

    it('should throw if challenge not found', async () => {
      mockStorage.get.mockResolvedValue(null);

      await expect(service.verifyAndConsume('invalid-verifier')).rejects.toThrow(ChallengeValidationError);
    });

    it('should throw if challenge expired', async () => {
      const expiredRecord = {
        toolId: 'tool-1',
        sessionId: 'session-1',
        requestedScope: 'session',
        requestInfo: { toolName: 'Test Tool' },
        createdAt: Date.now() - 600000,
        expiresAt: Date.now() - 1000, // Expired
        webhookSent: false,
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(expiredRecord));

      await expect(service.verifyAndConsume('test-verifier')).rejects.toThrow('expired');
    });

    it('should return and delete valid challenge', async () => {
      const validRecord = {
        toolId: 'tool-1',
        sessionId: 'session-1',
        requestedScope: 'session',
        requestInfo: { toolName: 'Test Tool' },
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        webhookSent: false,
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(validRecord));

      const result = await service.verifyAndConsume('test-verifier');

      expect(result.toolId).toBe('tool-1');
      expect(mockStorage.delete).toHaveBeenCalledWith('test-challenge-456');
    });
  });

  describe('markWebhookSent', () => {
    beforeEach(async () => {
      service = new ChallengeService();
      await service.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitService = new ChallengeService();

      await expect(uninitService.markWebhookSent('challenge')).rejects.toThrow('not initialized');
    });

    it('should return false if challenge not found', async () => {
      mockStorage.get.mockResolvedValue(null);

      const result = await service.markWebhookSent('nonexistent');

      expect(result).toBe(false);
    });

    it('should delete and return false if expired', async () => {
      const expiredRecord = {
        expiresAt: Date.now() - 1000,
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(expiredRecord));

      const result = await service.markWebhookSent('expired-challenge');

      expect(result).toBe(false);
      expect(mockStorage.delete).toHaveBeenCalled();
    });

    it('should update record with webhookSent flag', async () => {
      const validRecord = {
        toolId: 'tool-1',
        expiresAt: Date.now() + 300000,
        webhookSent: false,
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(validRecord));

      const result = await service.markWebhookSent('valid-challenge');

      expect(result).toBe(true);
      expect(mockStorage.set).toHaveBeenCalledWith(
        'valid-challenge',
        expect.stringContaining('"webhookSent":true'),
        expect.any(Object),
      );
    });
  });

  describe('getChallenge', () => {
    beforeEach(async () => {
      service = new ChallengeService();
      await service.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitService = new ChallengeService();

      await expect(uninitService.getChallenge('challenge')).rejects.toThrow('not initialized');
    });

    it('should return null if not found', async () => {
      mockStorage.get.mockResolvedValue(null);

      const result = await service.getChallenge('nonexistent');

      expect(result).toBeNull();
    });

    it('should delete and return null if expired', async () => {
      const expiredRecord = {
        expiresAt: Date.now() - 1000,
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(expiredRecord));

      const result = await service.getChallenge('expired-challenge');

      expect(result).toBeNull();
      expect(mockStorage.delete).toHaveBeenCalled();
    });

    it('should return valid challenge', async () => {
      const validRecord = {
        toolId: 'tool-1',
        expiresAt: Date.now() + 300000,
      };
      mockStorage.get.mockResolvedValue(JSON.stringify(validRecord));

      const result = await service.getChallenge('valid-challenge');

      expect(result?.toolId).toBe('tool-1');
    });
  });

  describe('deleteChallenge', () => {
    beforeEach(async () => {
      service = new ChallengeService();
      await service.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitService = new ChallengeService();

      await expect(uninitService.deleteChallenge('challenge')).rejects.toThrow('not initialized');
    });

    it('should return false if not exists', async () => {
      mockStorage.exists.mockResolvedValue(false);

      const result = await service.deleteChallenge('nonexistent');

      expect(result).toBe(false);
    });

    it('should delete and return true if exists', async () => {
      mockStorage.exists.mockResolvedValue(true);

      const result = await service.deleteChallenge('existing-challenge');

      expect(result).toBe(true);
      expect(mockStorage.delete).toHaveBeenCalledWith('existing-challenge');
    });
  });

  describe('close', () => {
    it('should disconnect owned storage', async () => {
      service = new ChallengeService();
      await service.initialize();

      await service.close();

      expect(mockStorage.root.disconnect).toHaveBeenCalled();
    });

    it('should not disconnect external storage', async () => {
      const externalStorage = {
        namespace: jest.fn().mockReturnValue(mockStorage),
      };
      service = new ChallengeService({
        storageInstance: externalStorage as any,
      });
      await service.initialize();

      await service.close();

      expect(mockStorage.root.disconnect).not.toHaveBeenCalled();
    });
  });
});

describe('createMemoryChallengeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create service with memory storage', () => {
    const service = createMemoryChallengeService();
    expect(service).toBeInstanceOf(ChallengeService);
    expect(createMemoryStorage).toHaveBeenCalled();
  });

  it('should pass options to service', () => {
    const service = createMemoryChallengeService({
      namespace: 'custom',
      defaultTtlSeconds: 600,
    });
    expect(service).toBeInstanceOf(ChallengeService);
  });
});
