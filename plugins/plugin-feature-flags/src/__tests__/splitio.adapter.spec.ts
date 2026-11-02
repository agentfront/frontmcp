describe('SplitioFeatureFlagAdapter', () => {
  const ctx = { userId: 'user-1', sessionId: 'session-1', attributes: { plan: 'pro' } };

  // Mock the Split.io SDK
  const mockGetTreatment = jest.fn();
  const mockReady = jest.fn().mockResolvedValue(undefined);
  const mockDestroy = jest.fn().mockResolvedValue(undefined);
  const mockOn = jest.fn();
  const mockOff = jest.fn();
  const mockClient = jest.fn().mockReturnValue({
    getTreatment: mockGetTreatment,
    ready: mockReady,
    destroy: mockDestroy,
    on: mockOn,
    off: mockOff,
    Event: { SDK_UPDATE: 'state::update' },
  });
  const mockSplitFactory = jest.fn().mockReturnValue({ client: mockClient });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockReady.mockResolvedValue(undefined);

    jest.mock(
      '@splitsoftware/splitio',
      () => ({
        SplitFactory: mockSplitFactory,
      }),
      { virtual: true },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createAdapter(apiKey = 'test-key') {
    const { SplitioFeatureFlagAdapter } = require('../adapters/splitio.adapter');
    return new SplitioFeatureFlagAdapter({ apiKey });
  }

  describe('initialize', () => {
    it('should create factory and wait for client ready', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      expect(mockSplitFactory).toHaveBeenCalledWith({
        core: { authorizationKey: 'test-key' },
      });
      expect(mockClient).toHaveBeenCalled();
      expect(mockReady).toHaveBeenCalled();
    });

    it('should throw if splitio module not found', async () => {
      jest.doMock(
        '@splitsoftware/splitio',
        () => {
          throw new Error('Cannot find module');
        },
        { virtual: true },
      );

      const { SplitioFeatureFlagAdapter } = jest.requireActual('../adapters/splitio.adapter');
      const adapter = new SplitioFeatureFlagAdapter({ apiKey: 'key' });

      // The adapter will try to require the module and fail
      await expect(adapter.initialize()).rejects.toThrow('Split.io SDK not found');
    });
  });

  describe('isEnabled', () => {
    it('should return true when treatment is "on"', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockReturnValue('on');
      const result = await adapter.isEnabled('my-flag', ctx);

      expect(result).toBe(true);
      expect(mockGetTreatment).toHaveBeenCalledWith('user-1', 'my-flag', { plan: 'pro' });
    });

    it('should return false when treatment is "off"', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockReturnValue('off');
      const result = await adapter.isEnabled('my-flag', ctx);

      expect(result).toBe(false);
    });

    it('should use sessionId when userId is not available', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockReturnValue('on');
      await adapter.isEnabled('my-flag', { sessionId: 'sess-1' });

      expect(mockGetTreatment).toHaveBeenCalledWith('sess-1', 'my-flag', undefined);
    });

    it('should use "anonymous" when neither userId nor sessionId available', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockReturnValue('on');
      await adapter.isEnabled('my-flag', {});

      expect(mockGetTreatment).toHaveBeenCalledWith('anonymous', 'my-flag', undefined);
    });

    it('should throw if not initialized', async () => {
      const adapter = await createAdapter();
      await expect(adapter.isEnabled('flag', ctx)).rejects.toThrow('not initialized');
    });
  });

  describe('getVariant', () => {
    it('should return variant from treatment', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockReturnValue('v2');
      const result = await adapter.getVariant('my-flag', ctx);

      expect(result).toEqual({ name: 'v2', value: 'v2', enabled: false });
    });

    it('should return enabled true for "on" treatment', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockReturnValue('on');
      const result = await adapter.getVariant('my-flag', ctx);

      expect(result).toEqual({ name: 'on', value: 'on', enabled: true });
    });
  });

  describe('evaluateFlags', () => {
    it('should batch evaluate multiple flags', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();

      mockGetTreatment.mockImplementation((_key: string, flag: string) => {
        return flag === 'flag-a' ? 'on' : 'off';
      });

      const results = await adapter.evaluateFlags(['flag-a', 'flag-b'], ctx);
      expect(results.get('flag-a')).toBe(true);
      expect(results.get('flag-b')).toBe(false);
    });
  });

  describe('subscribe', () => {
    it("follows the client's SDK_UPDATE events until it is stopped", async () => {
      const adapter = await createAdapter();
      await adapter.initialize();
      const listener = jest.fn();

      const stop = adapter.subscribe(listener);
      expect(mockOn).toHaveBeenCalledWith('state::update', listener);

      stop();
      expect(mockOff).toHaveBeenCalledWith('state::update', listener);
    });

    it('follows nothing before it is initialized', async () => {
      const adapter = await createAdapter();
      expect(() => adapter.subscribe(jest.fn())()).not.toThrow();
      expect(mockOn).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should destroy client', async () => {
      const adapter = await createAdapter();
      await adapter.initialize();
      await adapter.destroy();

      expect(mockDestroy).toHaveBeenCalled();
    });

    it('should be safe to call when not initialized', async () => {
      const adapter = await createAdapter();
      await expect(adapter.destroy()).resolves.toBeUndefined();
    });
  });
});
