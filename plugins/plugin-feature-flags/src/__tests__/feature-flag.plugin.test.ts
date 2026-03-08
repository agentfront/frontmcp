import FeatureFlagPlugin from '../feature-flag.plugin';
import { FeatureFlagAdapterToken, FeatureFlagConfigToken, FeatureFlagAccessorToken } from '../feature-flag.symbols';
import { StaticFeatureFlagAdapter } from '../adapters/static.adapter';
import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import { getFeatureFlags, tryGetFeatureFlags } from '../feature-flag.context-extension';
import * as barrel from '../index';

describe('FeatureFlagPlugin', () => {
  describe('constructor', () => {
    it('should store options', () => {
      const plugin = new FeatureFlagPlugin({
        adapter: 'static',
        flags: { 'my-flag': true },
      });
      expect(plugin.options.adapter).toBe('static');
    });
  });

  describe('dynamicProviders', () => {
    it('should create static adapter provider', () => {
      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'static',
        flags: { 'flag-a': true, 'flag-b': false },
      });

      expect(providers.length).toBe(3); // adapter + config + accessor
      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken);
      expect(adapterProvider).toBeDefined();
      expect((adapterProvider as any).useValue).toBeInstanceOf(StaticFeatureFlagAdapter);
    });

    it('should create config provider', () => {
      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'static',
        flags: { 'flag-a': true },
      });

      const configProvider = providers.find((p: any) => p.provide === FeatureFlagConfigToken);
      expect(configProvider).toBeDefined();
      expect((configProvider as any).useValue).toEqual(
        expect.objectContaining({ adapter: 'static', flags: { 'flag-a': true } }),
      );
    });

    it('should create context-scoped accessor provider', () => {
      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'static',
        flags: {},
      });

      const accessorProvider = providers.find((p: any) => p.provide === FeatureFlagAccessorToken);
      expect(accessorProvider).toBeDefined();
      expect((accessorProvider as any).name).toBe('feature-flags:accessor');
    });

    it('should create splitio adapter provider with factory', () => {
      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'splitio',
        config: { apiKey: 'test-key' },
      });

      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken);
      expect(adapterProvider).toBeDefined();
      expect((adapterProvider as any).name).toBe('feature-flags:adapter:splitio');
      expect(typeof (adapterProvider as any).useFactory).toBe('function');
    });

    it('should create launchdarkly adapter provider with factory', () => {
      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'launchdarkly',
        config: { sdkKey: 'sdk-test' },
      });

      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken);
      expect(adapterProvider).toBeDefined();
      expect((adapterProvider as any).name).toBe('feature-flags:adapter:launchdarkly');
    });

    it('should create unleash adapter provider with factory', () => {
      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'unleash',
        config: { url: 'https://unleash.test', appName: 'test' },
      });

      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken);
      expect(adapterProvider).toBeDefined();
      expect((adapterProvider as any).name).toBe('feature-flags:adapter:unleash');
    });

    it('should use custom adapter instance directly', () => {
      const customAdapter: FeatureFlagAdapter = {
        initialize: jest.fn(),
        isEnabled: jest.fn(),
        getVariant: jest.fn(),
        evaluateFlags: jest.fn(),
        destroy: jest.fn(),
      };

      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'custom',
        adapterInstance: customAdapter,
      });

      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken);
      expect(adapterProvider).toBeDefined();
      expect((adapterProvider as any).useValue).toBe(customAdapter);
    });
  });

  describe('hooks', () => {
    let plugin: FeatureFlagPlugin;
    let mockAdapter: FeatureFlagAdapter;

    beforeEach(() => {
      mockAdapter = {
        initialize: jest.fn().mockResolvedValue(undefined),
        isEnabled: jest.fn().mockResolvedValue(false),
        getVariant: jest.fn().mockResolvedValue({ name: 'off', value: undefined, enabled: false }),
        evaluateFlags: jest.fn().mockResolvedValue(new Map()),
        destroy: jest.fn().mockResolvedValue(undefined),
      };

      plugin = new FeatureFlagPlugin({ adapter: 'static', flags: {} });
      // Mock the `get` method to return our mock adapter
      (plugin as any).get = jest.fn().mockReturnValue(mockAdapter);
    });

    describe('filterListTools', () => {
      it('should not filter tools without featureFlag metadata', async () => {
        const tools = [
          { appName: 'app1', tool: { metadata: { name: 'tool-a' } } },
          { appName: 'app1', tool: { metadata: { name: 'tool-b' } } },
        ];
        const flowCtx = { state: { tools, set: jest.fn() } } as any;

        await plugin.filterListTools(flowCtx);
        expect(flowCtx.state.set).not.toHaveBeenCalled();
      });

      it('should filter out tools with disabled flags', async () => {
        const tools = [
          { appName: 'app1', tool: { metadata: { name: 'tool-a', featureFlag: 'flag-a' } } },
          { appName: 'app1', tool: { metadata: { name: 'tool-b' } } },
          { appName: 'app1', tool: { metadata: { name: 'tool-c', featureFlag: 'flag-c' } } },
        ];
        (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(
          new Map([
            ['flag-a', false],
            ['flag-c', true],
          ]),
        );

        const flowCtx = { state: { tools, set: jest.fn() } } as any;
        await plugin.filterListTools(flowCtx);

        expect(flowCtx.state.set).toHaveBeenCalledWith('tools', [
          tools[1], // no flag, passes through
          tools[2], // flag-c is enabled
        ]);
      });

      it('should use defaultValue from object ref when flag not in results', async () => {
        const tools = [
          {
            appName: 'app1',
            tool: { metadata: { name: 'tool-a', featureFlag: { key: 'unknown-flag', defaultValue: true } } },
          },
        ];
        (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map());

        const flowCtx = { state: { tools, set: jest.fn() } } as any;
        await plugin.filterListTools(flowCtx);

        expect(flowCtx.state.set).toHaveBeenCalledWith('tools', [tools[0]]);
      });

      it('should handle empty tools array', async () => {
        const flowCtx = { state: { tools: [], set: jest.fn() } } as any;
        await plugin.filterListTools(flowCtx);
        expect(flowCtx.state.set).not.toHaveBeenCalled();
      });

      it('should handle undefined tools', async () => {
        const flowCtx = { state: { tools: undefined, set: jest.fn() } } as any;
        await plugin.filterListTools(flowCtx);
        expect(flowCtx.state.set).not.toHaveBeenCalled();
      });
    });

    describe('filterListResources', () => {
      it('should filter resources by feature flags', async () => {
        const resources = [
          { ownerName: 'app1', resource: { metadata: { name: 'res-a', featureFlag: 'flag-a' } } },
          { ownerName: 'app1', resource: { metadata: { name: 'res-b' } } },
        ];
        (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', false]]));

        const flowCtx = { state: { resources, set: jest.fn() } } as any;
        await plugin.filterListResources(flowCtx);

        expect(flowCtx.state.set).toHaveBeenCalledWith('resources', [resources[1]]);
      });

      it('should skip filtering when no resources have flags', async () => {
        const resources = [{ ownerName: 'app1', resource: { metadata: { name: 'res-a' } } }];
        const flowCtx = { state: { resources, set: jest.fn() } } as any;
        await plugin.filterListResources(flowCtx);
        expect(flowCtx.state.set).not.toHaveBeenCalled();
      });
    });

    describe('filterListPrompts', () => {
      it('should filter prompts by feature flags', async () => {
        const prompts = [
          { ownerName: 'app1', prompt: { metadata: { name: 'prompt-a', featureFlag: 'flag-a' } } },
          { ownerName: 'app1', prompt: { metadata: { name: 'prompt-b' } } },
        ];
        (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', true]]));

        const flowCtx = { state: { prompts, set: jest.fn() } } as any;
        await plugin.filterListPrompts(flowCtx);

        // Both should remain since flag-a is enabled
        expect(flowCtx.state.set).toHaveBeenCalledWith('prompts', [prompts[0], prompts[1]]);
      });
    });

    describe('filterSearchSkills', () => {
      it('should filter skills by feature flags', async () => {
        const results = [
          { metadata: { name: 'skill-a', featureFlag: 'flag-a' } },
          { metadata: { name: 'skill-b' } },
          { metadata: { name: 'skill-c', featureFlag: 'flag-c' } },
        ];
        (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(
          new Map([
            ['flag-a', false],
            ['flag-c', true],
          ]),
        );

        const flowCtx = { state: { results, set: jest.fn() } } as any;
        await plugin.filterSearchSkills(flowCtx);

        expect(flowCtx.state.set).toHaveBeenCalledWith('results', [results[1], results[2]]);
      });

      it('should skip filtering when no skills have flags', async () => {
        const results = [{ metadata: { name: 'skill-a' } }];
        const flowCtx = { state: { results, set: jest.fn() } } as any;
        await plugin.filterSearchSkills(flowCtx);
        expect(flowCtx.state.set).not.toHaveBeenCalled();
      });
    });

    describe('gateToolExecution', () => {
      it('should allow tools without featureFlag metadata', async () => {
        const flowCtx = {
          state: { tool: { metadata: { name: 'tool-a' } } },
        } as any;

        await expect(plugin.gateToolExecution(flowCtx)).resolves.toBeUndefined();
      });

      it('should allow tools with enabled flags', async () => {
        (mockAdapter.isEnabled as jest.Mock).mockResolvedValue(true);
        const flowCtx = {
          state: { tool: { metadata: { name: 'tool-a', featureFlag: 'flag-a' } } },
        } as any;

        await expect(plugin.gateToolExecution(flowCtx)).resolves.toBeUndefined();
      });

      it('should throw for tools with disabled flags', async () => {
        (mockAdapter.isEnabled as jest.Mock).mockResolvedValue(false);
        const flowCtx = {
          state: { tool: { metadata: { name: 'tool-a', featureFlag: 'flag-a' } } },
        } as any;

        await expect(plugin.gateToolExecution(flowCtx)).rejects.toThrow(
          'Tool "tool-a" is disabled by feature flag "flag-a"',
        );
      });

      it('should use defaultValue on adapter error for object ref', async () => {
        (mockAdapter.isEnabled as jest.Mock).mockRejectedValue(new Error('fail'));
        const flowCtx = {
          state: { tool: { metadata: { name: 'tool-a', featureFlag: { key: 'flag-a', defaultValue: true } } } },
        } as any;

        await expect(plugin.gateToolExecution(flowCtx)).resolves.toBeUndefined();
      });

      it('should throw on adapter error with no defaultValue', async () => {
        (mockAdapter.isEnabled as jest.Mock).mockRejectedValue(new Error('fail'));
        const flowCtx = {
          state: { tool: { metadata: { name: 'tool-a', featureFlag: 'flag-a' } } },
        } as any;

        await expect(plugin.gateToolExecution(flowCtx)).rejects.toThrow(
          'Tool "tool-a" is disabled by feature flag "flag-a"',
        );
      });

      it('should handle undefined tool state', async () => {
        const flowCtx = { state: { tool: undefined } } as any;
        await expect(plugin.gateToolExecution(flowCtx)).resolves.toBeUndefined();
      });
    });
  });

  describe('dynamicProviders factory execution', () => {
    it('should execute splitio factory and call initialize', async () => {
      jest.mock(
        '@splitsoftware/splitio',
        () => ({
          SplitFactory: jest.fn().mockReturnValue({
            client: jest.fn().mockReturnValue({
              getTreatment: jest.fn(),
              ready: jest.fn().mockResolvedValue(undefined),
              destroy: jest.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
        { virtual: true },
      );

      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'splitio',
        config: { apiKey: 'test' },
      });
      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken) as any;
      const adapter = await adapterProvider.useFactory();
      expect(adapter).toBeDefined();
    });

    it('should execute launchdarkly factory and call initialize', async () => {
      jest.mock(
        '@launchdarkly/node-server-sdk',
        () => ({
          init: jest.fn().mockReturnValue({
            variation: jest.fn(),
            variationDetail: jest.fn(),
            waitForInitialization: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
          }),
        }),
        { virtual: true },
      );

      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'launchdarkly',
        config: { sdkKey: 'test' },
      });
      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken) as any;
      const adapter = await adapterProvider.useFactory();
      expect(adapter).toBeDefined();
    });

    it('should execute unleash factory and call initialize', async () => {
      jest.mock(
        'unleash-client',
        () => ({
          Unleash: jest.fn().mockImplementation(() => ({
            isEnabled: jest.fn(),
            getVariant: jest.fn(),
            start: jest.fn().mockResolvedValue(undefined),
            destroy: jest.fn(),
          })),
        }),
        { virtual: true },
      );

      const providers = FeatureFlagPlugin.dynamicProviders({
        adapter: 'unleash',
        config: { url: 'https://test.com', appName: 'test' },
      });
      const adapterProvider = providers.find((p: any) => p.provide === FeatureFlagAdapterToken) as any;
      const adapter = await adapterProvider.useFactory();
      expect(adapter).toBeDefined();
    });
  });

  describe('context extension helpers', () => {
    it('getFeatureFlags should call ctx.get with token', () => {
      const mockAccessor = { isEnabled: jest.fn() };
      const ctx = { get: jest.fn().mockReturnValue(mockAccessor) };
      const result = getFeatureFlags(ctx);
      expect(result).toBe(mockAccessor);
      expect(ctx.get).toHaveBeenCalledWith(FeatureFlagAccessorToken);
    });

    it('tryGetFeatureFlags should call ctx.tryGet with token', () => {
      const mockAccessor = { isEnabled: jest.fn() };
      const ctx = { tryGet: jest.fn().mockReturnValue(mockAccessor) };
      const result = tryGetFeatureFlags(ctx);
      expect(result).toBe(mockAccessor);
    });

    it('tryGetFeatureFlags should return undefined when tryGet is not available', () => {
      const ctx = {};
      const result = tryGetFeatureFlags(ctx);
      expect(result).toBeUndefined();
    });
  });

  describe('barrel exports (index.ts)', () => {
    it('should export FeatureFlagPlugin as default', () => {
      expect(barrel.default).toBe(FeatureFlagPlugin);
    });

    it('should export named FeatureFlagPlugin', () => {
      expect(barrel.FeatureFlagPlugin).toBe(FeatureFlagPlugin);
    });

    it('should export DI tokens', () => {
      expect(barrel.FeatureFlagAdapterToken).toBe(FeatureFlagAdapterToken);
      expect(barrel.FeatureFlagConfigToken).toBe(FeatureFlagConfigToken);
      expect(barrel.FeatureFlagAccessorToken).toBe(FeatureFlagAccessorToken);
    });

    it('should export adapter classes', () => {
      expect(barrel.StaticFeatureFlagAdapter).toBe(StaticFeatureFlagAdapter);
      expect(barrel.SplitioFeatureFlagAdapter).toBeDefined();
      expect(barrel.LaunchDarklyFeatureFlagAdapter).toBeDefined();
      expect(barrel.UnleashFeatureFlagAdapter).toBeDefined();
    });

    it('should export FeatureFlagAccessor', () => {
      expect(barrel.FeatureFlagAccessor).toBeDefined();
    });

    it('should export helper functions', () => {
      expect(barrel.getFeatureFlags).toBe(getFeatureFlags);
      expect(barrel.tryGetFeatureFlags).toBe(tryGetFeatureFlags);
    });
  });
});
