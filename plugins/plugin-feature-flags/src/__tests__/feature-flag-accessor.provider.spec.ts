import { FeatureFlagAccessor } from '../providers/feature-flag-accessor.provider';
import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import type { FeatureFlagPluginOptions } from '../feature-flag.types';
import type { FrontMcpContext } from '@frontmcp/sdk';

function createMockAdapter(overrides: Partial<FeatureFlagAdapter> = {}): FeatureFlagAdapter {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    isEnabled: jest.fn().mockResolvedValue(false),
    getVariant: jest.fn().mockResolvedValue({ name: 'off', value: undefined, enabled: false }),
    evaluateFlags: jest.fn().mockResolvedValue(new Map()),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockContext(overrides: Partial<FrontMcpContext> = {}): FrontMcpContext {
  return {
    sessionId: 'test-session-id',
    authInfo: {
      clientId: 'test-client',
      extra: { sub: 'user-123', userId: 'user-456' },
    },
    ...overrides,
  } as any;
}

describe('FeatureFlagAccessor', () => {
  describe('isEnabled', () => {
    it('should delegate to adapter', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      const result = await accessor.isEnabled('my-flag');
      expect(result).toBe(true);
      expect(adapter.isEnabled).toHaveBeenCalledWith(
        'my-flag',
        expect.objectContaining({
          userId: 'user-123',
          sessionId: 'test-session-id',
        }),
      );
    });

    it('should return defaultValue on adapter error', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockRejectedValue(new Error('network error')),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
        defaultValue: true,
      } as FeatureFlagPluginOptions);

      const result = await accessor.isEnabled('my-flag');
      expect(result).toBe(true);
    });

    it('should return per-call defaultValue over config defaultValue on error', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockRejectedValue(new Error('network error')),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
        defaultValue: true,
      } as FeatureFlagPluginOptions);

      const result = await accessor.isEnabled('my-flag', false);
      expect(result).toBe(false);
    });

    it('should return false on error when no defaultValue configured', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockRejectedValue(new Error('fail')),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      const result = await accessor.isEnabled('my-flag');
      expect(result).toBe(false);
    });
  });

  describe('caching', () => {
    it('should not cache when strategy is none', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
        cacheStrategy: 'none',
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('my-flag');
      await accessor.isEnabled('my-flag');
      expect(adapter.isEnabled).toHaveBeenCalledTimes(2);
    });

    it('should cache when strategy is session', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
        cacheStrategy: 'session',
        cacheTtlMs: 60_000,
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('my-flag');
      await accessor.isEnabled('my-flag');
      expect(adapter.isEnabled).toHaveBeenCalledTimes(1);
    });

    it('should re-evaluate after cache TTL expires', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });

      let currentTime = 1000;
      const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
        cacheStrategy: 'session',
        cacheTtlMs: 5_000,
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('my-flag'); // call 1 - cache miss
      expect(adapter.isEnabled).toHaveBeenCalledTimes(1);

      currentTime = 2000; // 1s later, within TTL
      await accessor.isEnabled('my-flag'); // call 2 - cache hit
      expect(adapter.isEnabled).toHaveBeenCalledTimes(1);

      currentTime = 10_000; // 9s later, TTL expired
      await accessor.isEnabled('my-flag'); // call 3 - cache expired, re-evaluate
      expect(adapter.isEnabled).toHaveBeenCalledTimes(2);

      dateNowSpy.mockRestore();
    });

    it('should cache with request strategy', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(false),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
        cacheStrategy: 'request',
        cacheTtlMs: 5_000,
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('flag-a');
      await accessor.isEnabled('flag-a');
      expect(adapter.isEnabled).toHaveBeenCalledTimes(1);
    });
  });

  describe('context resolution', () => {
    it('should use custom userIdResolver', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const ctx = createMockContext();
      const accessor = new FeatureFlagAccessor(adapter, ctx, {
        adapter: 'static',
        flags: {},
        userIdResolver: () => 'custom-user-id',
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('flag');
      expect(adapter.isEnabled).toHaveBeenCalledWith(
        'flag',
        expect.objectContaining({
          userId: 'custom-user-id',
        }),
      );
    });

    it('should use custom attributesResolver', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const ctx = createMockContext();
      const accessor = new FeatureFlagAccessor(adapter, ctx, {
        adapter: 'static',
        flags: {},
        attributesResolver: () => ({ plan: 'enterprise' }),
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('flag');
      expect(adapter.isEnabled).toHaveBeenCalledWith(
        'flag',
        expect.objectContaining({
          attributes: { plan: 'enterprise' },
        }),
      );
    });

    it('should fallback to authInfo.extra.sub for userId', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const ctx = createMockContext({
        authInfo: { extra: { sub: 'sub-user' } } as any,
      });
      const accessor = new FeatureFlagAccessor(adapter, ctx, {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('flag');
      expect(adapter.isEnabled).toHaveBeenCalledWith(
        'flag',
        expect.objectContaining({
          userId: 'sub-user',
        }),
      );
    });

    it('should fallback to clientId when no sub/userId', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const ctx = createMockContext({
        authInfo: { clientId: 'client-x', extra: {} } as any,
      });
      const accessor = new FeatureFlagAccessor(adapter, ctx, {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('flag');
      expect(adapter.isEnabled).toHaveBeenCalledWith(
        'flag',
        expect.objectContaining({
          userId: 'client-x',
        }),
      );
    });

    it('should have undefined userId when no auth info', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const ctx = createMockContext({ authInfo: undefined as any });
      const accessor = new FeatureFlagAccessor(adapter, ctx, {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      await accessor.isEnabled('flag');
      expect(adapter.isEnabled).toHaveBeenCalledWith(
        'flag',
        expect.objectContaining({
          userId: undefined,
        }),
      );
    });
  });

  describe('getVariant', () => {
    it('should delegate to adapter', async () => {
      const adapter = createMockAdapter({
        getVariant: jest.fn().mockResolvedValue({ name: 'v2', value: 'new', enabled: true }),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      const result = await accessor.getVariant('my-flag');
      expect(result).toEqual({ name: 'v2', value: 'new', enabled: true });
    });
  });

  describe('evaluateFlags', () => {
    it('should delegate to adapter', async () => {
      const map = new Map([
        ['a', true],
        ['b', false],
      ]);
      const adapter = createMockAdapter({
        evaluateFlags: jest.fn().mockResolvedValue(map),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      const result = await accessor.evaluateFlags(['a', 'b']);
      expect(result).toEqual(map);
    });
  });

  describe('resolveRef', () => {
    it('should handle string ref', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockResolvedValue(true),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      const result = await accessor.resolveRef('my-flag');
      expect(result).toBe(true);
    });

    it('should handle object ref with defaultValue', async () => {
      const adapter = createMockAdapter({
        isEnabled: jest.fn().mockRejectedValue(new Error('fail')),
      });
      const accessor = new FeatureFlagAccessor(adapter, createMockContext(), {
        adapter: 'static',
        flags: {},
      } as FeatureFlagPluginOptions);

      const result = await accessor.resolveRef({ key: 'my-flag', defaultValue: true });
      expect(result).toBe(true);
    });
  });
});
