// file: plugins/plugin-remember/src/__tests__/remember-storage.provider.test.ts

import 'reflect-metadata';

// Create mock storage before importing the module
const mockNamespacedStorage = {
  set: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  keys: jest.fn(),
  root: { disconnect: jest.fn() },
};

const mockRootStorage = {
  namespace: jest.fn().mockReturnValue(mockNamespacedStorage),
};

// Use doMock to avoid hoisting issues with SDK imports
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
        root: { disconnect: jest.fn() },
      }),
    }),
  };
});

import { RememberStorageProvider, createRememberMemoryProvider } from '../providers/remember-storage.provider';
import { createStorage, createMemoryStorage } from '@frontmcp/utils';

describe('RememberStorageProvider', () => {
  let provider: RememberStorageProvider;
  let currentMockStorage: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create new mock for each test
    currentMockStorage = {
      set: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      keys: jest.fn(),
      root: { disconnect: jest.fn() },
    };

    const mockRoot = {
      namespace: jest.fn().mockReturnValue(currentMockStorage),
    };

    (createStorage as jest.Mock).mockResolvedValue(mockRoot);
  });

  describe('constructor', () => {
    it('should create provider with default options', () => {
      provider = new RememberStorageProvider();
      expect(provider).toBeDefined();
    });

    it('should create provider with custom storage config', () => {
      provider = new RememberStorageProvider({
        storage: { type: 'redis', redis: { url: 'redis://localhost' } },
      });
      expect(provider).toBeDefined();
    });

    it('should create provider with custom namespace', () => {
      provider = new RememberStorageProvider({
        namespace: 'custom-namespace',
      });
      expect(provider).toBeDefined();
    });

    it('should create provider with default TTL', () => {
      provider = new RememberStorageProvider({
        defaultTTLSeconds: 3600,
      });
      expect(provider).toBeDefined();
    });

    it('should create provider with storage instance', () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(currentMockStorage),
      };
      provider = new RememberStorageProvider({
        storageInstance: mockInstance as any,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with auto storage config', async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();

      expect(createStorage).toHaveBeenCalledWith({ type: 'auto' });
    });

    it('should initialize with storage instance', async () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(currentMockStorage),
      };
      provider = new RememberStorageProvider({
        storageInstance: mockInstance as any,
      });

      await provider.initialize();

      expect(mockInstance.namespace).toHaveBeenCalledWith('remember');
    });

    it('should use custom namespace', async () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(currentMockStorage),
      };
      provider = new RememberStorageProvider({
        storageInstance: mockInstance as any,
        namespace: 'custom',
      });

      await provider.initialize();

      expect(mockInstance.namespace).toHaveBeenCalledWith('custom');
    });

    it('should not reinitialize if already initialized', async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();
      await provider.initialize(); // Second call

      expect(createStorage).toHaveBeenCalledTimes(1);
    });
  });

  describe('setValue', () => {
    beforeEach(async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new RememberStorageProvider();

      await expect(uninitProvider.setValue('key', 'value')).rejects.toThrow('RememberStorageProvider not initialized');
    });

    it('should set value without TTL', async () => {
      await provider.setValue('key', 'value');

      expect(currentMockStorage.set).toHaveBeenCalledWith('key', '"value"', {
        ttlSeconds: undefined,
      });
    });

    it('should set value with TTL', async () => {
      await provider.setValue('key', 'value', 3600);

      expect(currentMockStorage.set).toHaveBeenCalledWith('key', '"value"', {
        ttlSeconds: 3600,
      });
    });

    it('should serialize objects', async () => {
      await provider.setValue('key', { foo: 'bar' });

      expect(currentMockStorage.set).toHaveBeenCalledWith('key', JSON.stringify({ foo: 'bar' }), {
        ttlSeconds: undefined,
      });
    });

    it('should throw on undefined value', async () => {
      await expect(provider.setValue('key', undefined)).rejects.toThrow('Cannot store undefined');
    });

    it('should throw on NaN TTL', async () => {
      await expect(provider.setValue('key', 'value', NaN)).rejects.toThrow('Invalid TTL');
    });

    it('should throw on non-finite TTL', async () => {
      await expect(provider.setValue('key', 'value', Infinity)).rejects.toThrow('Invalid TTL');
    });

    it('should throw on zero TTL', async () => {
      await expect(provider.setValue('key', 'value', 0)).rejects.toThrow('must be positive');
    });

    it('should throw on negative TTL', async () => {
      await expect(provider.setValue('key', 'value', -1)).rejects.toThrow('must be positive');
    });

    it('should throw on non-integer TTL', async () => {
      await expect(provider.setValue('key', 'value', 3.5)).rejects.toThrow('must be an integer');
    });

    it('should use default TTL when not provided', async () => {
      const mockInstance = {
        namespace: jest.fn().mockReturnValue(currentMockStorage),
      };
      const newProvider = new RememberStorageProvider({
        storageInstance: mockInstance as any,
        defaultTTLSeconds: 1800,
      });
      await newProvider.initialize();

      await newProvider.setValue('key', 'value');

      expect(currentMockStorage.set).toHaveBeenCalledWith('key', '"value"', {
        ttlSeconds: 1800,
      });
    });
  });

  describe('getValue', () => {
    beforeEach(async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new RememberStorageProvider();

      await expect(uninitProvider.getValue('key')).rejects.toThrow('not initialized');
    });

    it('should return undefined when key not found', async () => {
      currentMockStorage.get.mockResolvedValue(null);

      const result = await provider.getValue('key');

      expect(result).toBeUndefined();
    });

    it('should return default value when key not found', async () => {
      currentMockStorage.get.mockResolvedValue(null);

      const result = await provider.getValue('key', 'default');

      expect(result).toBe('default');
    });

    it('should parse and return stored value', async () => {
      currentMockStorage.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));

      const result = await provider.getValue('key');

      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return default value on parse error', async () => {
      currentMockStorage.get.mockResolvedValue('invalid-json{');

      const result = await provider.getValue('key', 'default');

      expect(result).toBe('default');
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new RememberStorageProvider();

      await expect(uninitProvider.delete('key')).rejects.toThrow('not initialized');
    });

    it('should delete key', async () => {
      await provider.delete('key');

      expect(currentMockStorage.delete).toHaveBeenCalledWith('key');
    });
  });

  describe('exists', () => {
    beforeEach(async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new RememberStorageProvider();

      await expect(uninitProvider.exists('key')).rejects.toThrow('not initialized');
    });

    it('should return true when key exists', async () => {
      currentMockStorage.exists.mockResolvedValue(true);

      const result = await provider.exists('key');

      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      currentMockStorage.exists.mockResolvedValue(false);

      const result = await provider.exists('key');

      expect(result).toBe(false);
    });
  });

  describe('keys', () => {
    beforeEach(async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new RememberStorageProvider();

      await expect(uninitProvider.keys()).rejects.toThrow('not initialized');
    });

    it('should return keys with default pattern', async () => {
      currentMockStorage.keys.mockResolvedValue(['key1', 'key2']);

      const result = await provider.keys();

      expect(result).toEqual(['key1', 'key2']);
      expect(currentMockStorage.keys).toHaveBeenCalledWith('*');
    });

    it('should return keys with custom pattern', async () => {
      currentMockStorage.keys.mockResolvedValue(['user:1', 'user:2']);

      const result = await provider.keys('user:*');

      expect(result).toEqual(['user:1', 'user:2']);
      expect(currentMockStorage.keys).toHaveBeenCalledWith('user:*');
    });
  });

  describe('close', () => {
    it('should disconnect owned storage', async () => {
      provider = new RememberStorageProvider();
      await provider.initialize();

      await provider.close();

      expect(currentMockStorage.root.disconnect).toHaveBeenCalled();
    });

    it('should not disconnect external storage instance', async () => {
      const externalStorage = {
        namespace: jest.fn().mockReturnValue(currentMockStorage),
      };
      provider = new RememberStorageProvider({
        storageInstance: externalStorage as any,
      });
      await provider.initialize();

      await provider.close();

      expect(currentMockStorage.root.disconnect).not.toHaveBeenCalled();
    });
  });
});

describe('createRememberMemoryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create memory provider with default options', () => {
    const provider = createRememberMemoryProvider();
    expect(provider).toBeInstanceOf(RememberStorageProvider);
  });

  it('should create memory provider with custom namespace', () => {
    const provider = createRememberMemoryProvider({
      namespace: 'custom',
    });
    expect(provider).toBeInstanceOf(RememberStorageProvider);
  });

  it('should create memory provider with default TTL', () => {
    const provider = createRememberMemoryProvider({
      defaultTTLSeconds: 3600,
    });
    expect(provider).toBeInstanceOf(RememberStorageProvider);
  });
});
