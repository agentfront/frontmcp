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

jest.mock('@frontmcp/utils', () => ({
  createStorage: (...args: unknown[]) => mockCreateStorage(...args),
  createMemoryStorage: (...args: unknown[]) => mockCreateMemoryStorage(...args),
}));

import { createGuardManager } from '../guard.factory';
import { GuardManager } from '../guard.manager';

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
    expect(mockNamespace).toHaveBeenCalledWith('test:guard:');
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

    expect(mockNamespace).toHaveBeenCalledWith('mcp:guard:');
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
