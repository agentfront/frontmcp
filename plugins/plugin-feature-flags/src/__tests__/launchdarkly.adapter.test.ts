describe('LaunchDarklyFeatureFlagAdapter', () => {
  const ctx = { userId: 'user-1', sessionId: 'session-1', attributes: { country: 'US' } };

  const mockVariation = jest.fn();
  const mockVariationDetail = jest.fn();
  const mockWaitForInitialization = jest.fn().mockResolvedValue(undefined);
  const mockClose = jest.fn().mockResolvedValue(undefined);
  const mockInit = jest.fn().mockReturnValue({
    variation: mockVariation,
    variationDetail: mockVariationDetail,
    waitForInitialization: mockWaitForInitialization,
    close: mockClose,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockWaitForInitialization.mockResolvedValue(undefined);

    jest.mock(
      '@launchdarkly/node-server-sdk',
      () => ({
        init: mockInit,
      }),
      { virtual: true },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createAdapter(sdkKey = 'sdk-test') {
    const { LaunchDarklyFeatureFlagAdapter } = require('../adapters/launchdarkly.adapter');
    return new LaunchDarklyFeatureFlagAdapter({ sdkKey });
  }

  describe('initialize', () => {
    it('should init client and wait for initialization', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      expect(mockInit).toHaveBeenCalledWith('sdk-test');
      expect(mockWaitForInitialization).toHaveBeenCalled();
    });

    it('should throw if module not found', async () => {
      jest.mock(
        '@launchdarkly/node-server-sdk',
        () => {
          throw new Error('Cannot find module');
        },
        { virtual: true },
      );

      const { LaunchDarklyFeatureFlagAdapter } = jest.requireActual('../adapters/launchdarkly.adapter');
      const adapter = new LaunchDarklyFeatureFlagAdapter({ sdkKey: 'key' });
      await expect(adapter.initialize()).rejects.toThrow('LaunchDarkly SDK not found');
    });
  });

  describe('isEnabled', () => {
    it('should return result of variation()', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockVariation.mockResolvedValue(true);
      const result = await adapter.isEnabled('my-flag', ctx);

      expect(result).toBe(true);
      expect(mockVariation).toHaveBeenCalledWith(
        'my-flag',
        expect.objectContaining({ kind: 'user', key: 'user-1', country: 'US' }),
        false,
      );
    });

    it('should use sessionId when userId is not available', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockVariation.mockResolvedValue(false);
      await adapter.isEnabled('my-flag', { sessionId: 'sess-1' });

      expect(mockVariation).toHaveBeenCalledWith('my-flag', expect.objectContaining({ key: 'sess-1' }), false);
    });

    it('should use "anonymous" when no userId or sessionId', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockVariation.mockResolvedValue(false);
      await adapter.isEnabled('my-flag', {});

      expect(mockVariation).toHaveBeenCalledWith('my-flag', expect.objectContaining({ key: 'anonymous' }), false);
    });

    it('should throw if not initialized', async () => {
      const adapter = await createAdapter();
      await expect(adapter.isEnabled('flag', ctx)).rejects.toThrow('not initialized');
    });
  });

  describe('getVariant', () => {
    it('should return variant from variationDetail', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockVariationDetail.mockResolvedValue({ value: 'variant-a', variationIndex: 0 });
      const result = await adapter.getVariant('my-flag', ctx);

      expect(result).toEqual({ name: 'variant-a', value: 'variant-a', enabled: true });
    });

    it('should return disabled variant for false value', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockVariationDetail.mockResolvedValue({ value: false, variationIndex: 1 });
      const result = await adapter.getVariant('my-flag', ctx);

      expect(result).toEqual({ name: 'false', value: false, enabled: false });
    });
  });

  describe('evaluateFlags', () => {
    it('should batch evaluate multiple flags', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockVariation.mockImplementation((flag: string) => {
        return Promise.resolve(flag === 'flag-a');
      });

      const results = await adapter.evaluateFlags(['flag-a', 'flag-b'], ctx);
      expect(results.get('flag-a')).toBe(true);
      expect(results.get('flag-b')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should close client', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();
      await adapter.destroy();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should be safe to call when not initialized', async () => {
      const adapter = await createAdapter();
      await expect(adapter.destroy()).resolves.toBeUndefined();
    });
  });
});
