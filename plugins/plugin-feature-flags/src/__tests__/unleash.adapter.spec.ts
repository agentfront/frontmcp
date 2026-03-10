describe('UnleashFeatureFlagAdapter', () => {
  const ctx = { userId: 'user-1', sessionId: 'session-1', attributes: { tier: 'premium' } };

  const mockIsEnabled = jest.fn();
  const mockGetVariant = jest.fn();
  const mockStart = jest.fn().mockResolvedValue(undefined);
  const mockDestroyFn = jest.fn();

  const MockUnleash = jest.fn().mockImplementation(() => ({
    isEnabled: mockIsEnabled,
    getVariant: mockGetVariant,
    start: mockStart,
    destroy: mockDestroyFn,
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockStart.mockResolvedValue(undefined);

    jest.mock(
      'unleash-client',
      () => ({
        Unleash: MockUnleash,
      }),
      { virtual: true },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createAdapter(config: { url: string; appName: string; apiKey?: string }) {
    const { UnleashFeatureFlagAdapter } =
      require('../adapters/unleash.adapter') as typeof import('../adapters/unleash.adapter');
    return new UnleashFeatureFlagAdapter(config);
  }

  describe('initialize', () => {
    it('should create Unleash client and start', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      expect(MockUnleash).toHaveBeenCalledWith({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it('should pass apiKey as custom header', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
        apiKey: 'secret-key',
      });
      await adapter.initialize();

      expect(MockUnleash).toHaveBeenCalledWith({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
        customHeaders: { Authorization: 'secret-key' },
      });
    });

    it('should throw if module not found', async () => {
      jest.doMock(
        'unleash-client',
        () => {
          const err = new Error("Cannot find module 'unleash-client'");
          (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
          throw err;
        },
        { virtual: true },
      );

      const { UnleashFeatureFlagAdapter } = jest.requireActual('../adapters/unleash.adapter');
      const adapter = new UnleashFeatureFlagAdapter({
        url: 'https://unleash.test',
        appName: 'app',
      });
      await expect(adapter.initialize()).rejects.toThrow('Unleash SDK not found');
    });
  });

  describe('isEnabled', () => {
    it('should return result from unleash client', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      mockIsEnabled.mockReturnValue(true);
      const result = await adapter.isEnabled('my-flag', ctx);

      expect(result).toBe(true);
      expect(mockIsEnabled).toHaveBeenCalledWith('my-flag', {
        userId: 'user-1',
        sessionId: 'session-1',
        properties: { tier: 'premium' },
      });
    });

    it('should pass empty properties when no attributes', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      mockIsEnabled.mockReturnValue(false);
      await adapter.isEnabled('my-flag', {});

      expect(mockIsEnabled).toHaveBeenCalledWith('my-flag', {
        userId: undefined,
        sessionId: undefined,
        properties: {},
      });
    });

    it('should throw if not initialized', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await expect(adapter.isEnabled('flag', ctx)).rejects.toThrow('not initialized');
    });
  });

  describe('getVariant', () => {
    it('should return variant from unleash client', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      mockGetVariant.mockReturnValue({
        name: 'variant-a',
        payload: { value: 'data-a' },
        enabled: true,
      });

      const result = await adapter.getVariant('my-flag', ctx);
      expect(result).toEqual({ name: 'variant-a', value: 'data-a', enabled: true });
    });

    it('should handle missing variant fields', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      mockGetVariant.mockReturnValue({});
      const result = await adapter.getVariant('my-flag', ctx);
      expect(result).toEqual({ name: 'disabled', value: undefined, enabled: false });
    });

    it('should use variant name when no payload', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      mockGetVariant.mockReturnValue({ name: 'blue', enabled: true });
      const result = await adapter.getVariant('my-flag', ctx);
      expect(result).toEqual({ name: 'blue', value: 'blue', enabled: true });
    });
  });

  describe('evaluateFlags', () => {
    it('should batch evaluate multiple flags', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();

      mockIsEnabled.mockImplementation((flag: string) => flag === 'flag-a');

      const results = await adapter.evaluateFlags(['flag-a', 'flag-b'], ctx);
      expect(results.get('flag-a')).toBe(true);
      expect(results.get('flag-b')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should destroy client', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await adapter.initialize();
      await adapter.destroy();

      expect(mockDestroyFn).toHaveBeenCalled();
    });

    it('should be safe to call when not initialized', async () => {
      const adapter = await createAdapter({
        url: 'https://unleash.example.com/api',
        appName: 'my-app',
      });
      await expect(adapter.destroy()).resolves.toBeUndefined();
    });
  });
});
