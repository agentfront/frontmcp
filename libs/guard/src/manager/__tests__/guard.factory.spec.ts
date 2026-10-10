import { GuardError, GuardStorageUnavailableError } from '../../errors';
import { createGuardManager } from '../guard.factory';
import { GuardManager } from '../guard.manager';
import type { GuardConfig, GuardLogger } from '../types';

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockNamespace = jest.fn().mockReturnValue({
  connect: mockConnect,
  disconnect: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  mget: jest.fn(),
  mset: jest.fn(),
  mdelete: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
  count: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  incrBy: jest.fn(),
  publish: jest.fn(),
  subscribe: jest.fn(),
  supportsPubSub: jest.fn().mockReturnValue(false),
  prefix: 'mcp:guard:',
  namespace: jest.fn(),
  root: {},
});

const mockStorage = {
  connect: mockConnect,
  disconnect: jest.fn(),
  namespace: mockNamespace,
};

const mockCreateStorage = jest.fn().mockResolvedValue(mockStorage);
const mockCreateMemoryStorage = jest.fn().mockReturnValue(mockStorage);
const mockIsProduction = jest.fn().mockReturnValue(false);

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual<typeof import('@frontmcp/utils')>('@frontmcp/utils'),
  createStorage: (...args: unknown[]) => mockCreateStorage(...args),
  createMemoryStorage: (...args: unknown[]) => mockCreateMemoryStorage(...args),
  isProduction: () => mockIsProduction(),
}));

describe('createGuardManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use createStorage when storage config is provided', async () => {
    const config: GuardConfig = {
      enabled: true,
      storage: { provider: 'redis', host: 'localhost' } as unknown as GuardConfig['storage'],
      keyPrefix: 'test:guard:',
    };

    const manager = await createGuardManager({ config });

    expect(mockCreateStorage).toHaveBeenCalledWith(config.storage);
    expect(mockCreateMemoryStorage).not.toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalled();
    // The namespace adds its own separator, so the trailing colon is dropped
    // rather than doubled (`test:guard::…`).
    expect(mockNamespace).toHaveBeenCalledWith('test:guard');
    expect(manager).toBeInstanceOf(GuardManager);
  });

  it('should use createMemoryStorage and warn when no storage config', async () => {
    const logger: GuardLogger = {
      info: jest.fn(),
      warn: jest.fn(),
    };

    const config: GuardConfig = {
      enabled: true,
    };

    const manager = await createGuardManager({ config, logger });

    expect(mockCreateMemoryStorage).toHaveBeenCalled();
    expect(mockCreateStorage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No storage config provided'));
    expect(manager).toBeInstanceOf(GuardManager);
  });

  it('should use default keyPrefix when not specified', async () => {
    const config: GuardConfig = {
      enabled: true,
    };

    await createGuardManager({ config });

    expect(mockNamespace).toHaveBeenCalledWith('mcp:guard');
  });

  it('passes a prefix without a trailing colon through unchanged', async () => {
    await createGuardManager({ config: { enabled: true, keyPrefix: 'acme:rl' } });

    expect(mockNamespace).toHaveBeenCalledWith('acme:rl');
  });

  it('should log initialization details when logger is provided', async () => {
    const logger: GuardLogger = {
      info: jest.fn(),
      warn: jest.fn(),
    };

    const config: GuardConfig = {
      enabled: true,
      global: { maxRequests: 100 },
      globalConcurrency: { maxConcurrent: 10 },
      defaultRateLimit: { maxRequests: 50 },
      defaultConcurrency: { maxConcurrent: 5 },
      defaultTimeout: { executeMs: 30_000 },
      ipFilter: { denyList: ['1.2.3.4'] },
    };

    await createGuardManager({ config, logger });

    expect(logger.info).toHaveBeenCalledWith(
      'GuardManager initialized',
      expect.objectContaining({
        keyPrefix: 'mcp:guard:',
        hasGlobalRateLimit: true,
        hasGlobalConcurrency: true,
        hasDefaultRateLimit: true,
        hasDefaultConcurrency: true,
        hasDefaultTimeout: true,
        hasIpFilter: true,
      }),
    );
  });

  it('should log correct boolean flags when features are not configured', async () => {
    const logger: GuardLogger = {
      info: jest.fn(),
      warn: jest.fn(),
    };

    const config: GuardConfig = {
      enabled: true,
    };

    await createGuardManager({ config, logger });

    expect(logger.info).toHaveBeenCalledWith(
      'GuardManager initialized',
      expect.objectContaining({
        hasGlobalRateLimit: false,
        hasGlobalConcurrency: false,
        hasDefaultRateLimit: false,
        hasDefaultConcurrency: false,
        hasDefaultTimeout: false,
        hasIpFilter: false,
      }),
    );
  });

  it('should not fail when logger is not provided', async () => {
    const config: GuardConfig = {
      enabled: true,
    };

    await expect(createGuardManager({ config })).resolves.toBeInstanceOf(GuardManager);
  });
});

describe('createGuardManager — throttle.storage is unreachable', () => {
  const redisStorage = {
    type: 'redis',
    redis: { config: { host: 'localhost' } },
  } as unknown as GuardConfig['storage'];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects with a guard error that names throttle.storage and the memory fallback', async () => {
    mockCreateStorage.mockRejectedValueOnce(
      new Error('Failed to connect to Redis: connect ECONNREFUSED 127.0.0.1:6379'),
    );

    const failure = createGuardManager({ config: { enabled: true, storage: redisStorage } });

    await expect(failure).rejects.toBeInstanceOf(GuardStorageUnavailableError);
    await expect(failure).rejects.toBeInstanceOf(GuardError);
    await expect(failure).rejects.toThrow(/throttle\.storage/);
    await expect(failure).rejects.toThrow(/throttle\.storage\.fallback: 'memory'/);
    await expect(failure).rejects.toThrow(/ECONNREFUSED/);
  });

  it('keeps the storage failure as the cause and reports the backend type', async () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    mockCreateStorage.mockRejectedValueOnce(cause);

    const error = await createGuardManager({ config: { enabled: true, storage: redisStorage } }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(GuardStorageUnavailableError);
    const unavailable = error as GuardStorageUnavailableError;
    expect(unavailable.cause).toBe(cause);
    expect(unavailable.storageType).toBe('redis');
    expect(unavailable.code).toBe('GUARD_STORAGE_UNAVAILABLE');
  });

  it('wraps a connect() failure on the created storage the same way', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection lost'));

    await expect(createGuardManager({ config: { enabled: true, storage: redisStorage } })).rejects.toBeInstanceOf(
      GuardStorageUnavailableError,
    );
  });
});

describe('createGuardManager — ipFilter proxy options (#766)', () => {
  it('no longer warns that trustProxy and trustedProxyDepth are not read: the SDK reads them', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    await createGuardManager({
      config: {
        enabled: true,
        storage: {} as GuardConfig['storage'],
        ipFilter: { trustProxy: true, trustedProxyDepth: 2 },
      },
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('FRONTMCP_TRUST_PROXY'));
  });
});

describe('createGuardManager — throttle.storage stops answering after startup (#660)', () => {
  const limited = { maxRequests: 1, windowMs: 60_000 };

  function downNamespace(): unknown {
    const reject = () => Promise.reject(new Error('Connection is closed.'));
    return { ...mockNamespace(), mget: reject, incr: reject, expire: reject, supportsPubSub: () => false };
  }

  it('fails a call with GuardStorageUnavailableError naming the configured backend in production', async () => {
    mockIsProduction.mockReturnValueOnce(true);
    mockNamespace.mockReturnValueOnce(downNamespace());
    const manager = await createGuardManager({
      config: {
        enabled: true,
        defaultRateLimit: limited,
        storage: { type: 'redis', redis: { config: { host: 'localhost' } } },
      },
    });

    const error = await manager.checkRateLimit('tool', undefined, undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GuardStorageUnavailableError);
    expect((error as GuardStorageUnavailableError).storageType).toBe('redis');
  });

  it("keeps serving from per-instance counters when storage.fallback is 'memory'", async () => {
    mockIsProduction.mockReturnValue(true);
    try {
      mockNamespace.mockReturnValueOnce(downNamespace());
      mockCreateMemoryStorage.mockReturnValueOnce(jest.requireActual('@frontmcp/utils').createMemoryStorage());
      const logger: GuardLogger = { info: jest.fn(), warn: jest.fn() };
      const manager = await createGuardManager({
        config: {
          enabled: true,
          defaultRateLimit: limited,
          storage: { type: 'redis', redis: { config: { host: 'localhost' } }, fallback: 'memory' },
        },
        logger,
      });

      const first = await manager.checkRateLimit('tool', undefined, undefined);
      const second = await manager.checkRateLimit('tool', undefined, undefined);
      expect([first.allowed, second.allowed]).toEqual([true, false]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('throttle.storage (redis) is unavailable'));
    } finally {
      mockIsProduction.mockReturnValue(false);
    }
  });
});
