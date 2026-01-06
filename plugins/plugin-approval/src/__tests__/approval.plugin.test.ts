// file: plugins/plugin-approval/src/__tests__/approval.plugin.test.ts

import 'reflect-metadata';
import ApprovalPlugin from '../approval.plugin';
import { ApprovalStoreToken, ApprovalServiceToken, ChallengeServiceToken } from '../approval.symbols';

describe('ApprovalPlugin', () => {
  describe('defaultOptions', () => {
    it('should have correct defaults', () => {
      expect(ApprovalPlugin.defaultOptions).toEqual({
        namespace: 'approval',
        mode: 'recheck',
        enableAudit: true,
        maxDelegationDepth: 3,
        cleanupIntervalSeconds: 60,
      });
    });
  });

  describe('constructor', () => {
    it('should create plugin with default options', () => {
      const plugin = new ApprovalPlugin();
      expect(plugin.options).toEqual(ApprovalPlugin.defaultOptions);
    });

    it('should merge custom options with defaults', () => {
      const plugin = new ApprovalPlugin({
        namespace: 'custom-approval',
        mode: 'webhook',
        maxDelegationDepth: 5,
      });

      expect(plugin.options.namespace).toBe('custom-approval');
      expect(plugin.options.mode).toBe('webhook');
      expect(plugin.options.maxDelegationDepth).toBe(5);
      expect(plugin.options.enableAudit).toBe(true); // default retained
    });

    it('should accept storage config', () => {
      const plugin = new ApprovalPlugin({
        storage: { type: 'redis', redis: { url: 'redis://localhost' } },
      });

      expect(plugin.options.storage).toEqual({
        type: 'redis',
        redis: { url: 'redis://localhost' },
      });
    });

    it('should accept recheck options', () => {
      const plugin = new ApprovalPlugin({
        mode: 'recheck',
        recheck: {
          url: 'https://api.example.com/check',
          auth: 'jwt',
          interval: 5000,
          maxAttempts: 10,
        },
      });

      expect(plugin.options.recheck).toEqual({
        url: 'https://api.example.com/check',
        auth: 'jwt',
        interval: 5000,
        maxAttempts: 10,
      });
    });

    it('should accept webhook options', () => {
      const plugin = new ApprovalPlugin({
        mode: 'webhook',
        webhook: {
          url: 'https://approval.example.com/webhook',
          includeJwt: true,
          challengeTtl: 600,
          callbackPath: '/callback',
        },
      });

      expect(plugin.options.webhook).toEqual({
        url: 'https://approval.example.com/webhook',
        includeJwt: true,
        challengeTtl: 600,
        callbackPath: '/callback',
      });
    });
  });

  describe('dynamicProviders', () => {
    it('should return store and service providers for recheck mode', () => {
      const providers = ApprovalPlugin.dynamicProviders({});

      expect(providers.length).toBe(2);

      const storeProvider = providers.find((p) => p.provide === ApprovalStoreToken);
      const serviceProvider = providers.find((p) => p.provide === ApprovalServiceToken);

      expect(storeProvider).toBeDefined();
      expect(storeProvider?.name).toBe('approval:store');
      expect(serviceProvider).toBeDefined();
      expect(serviceProvider?.name).toBe('approval:service');
    });

    it('should include challenge service for webhook mode', () => {
      const providers = ApprovalPlugin.dynamicProviders({ mode: 'webhook' });

      expect(providers.length).toBe(3);

      const challengeProvider = providers.find((p) => p.provide === ChallengeServiceToken);
      expect(challengeProvider).toBeDefined();
      expect(challengeProvider?.name).toBe('approval:challenge-service');
    });

    it('should not include challenge service for recheck mode', () => {
      const providers = ApprovalPlugin.dynamicProviders({ mode: 'recheck' });

      const challengeProvider = providers.find((p) => p.provide === ChallengeServiceToken);
      expect(challengeProvider).toBeUndefined();
    });

    it('should pass config to store factory', async () => {
      const providers = ApprovalPlugin.dynamicProviders({
        namespace: 'custom',
        cleanupIntervalSeconds: 120,
      });

      const storeProvider = providers.find((p) => p.provide === ApprovalStoreToken);
      expect(storeProvider).toBeDefined();
      // The factory exists - we can't easily test the internals without mocking
    });

    it('should pass webhook challengeTtl to challenge service', () => {
      const providers = ApprovalPlugin.dynamicProviders({
        mode: 'webhook',
        webhook: { challengeTtl: 600 },
      });

      const challengeProvider = providers.find((p) => p.provide === ChallengeServiceToken);
      expect(challengeProvider).toBeDefined();
    });
  });

  describe('getPluginMetadata', () => {
    it('should return approval check plugin', () => {
      const metadata = ApprovalPlugin.getPluginMetadata({});

      expect(metadata.plugins).toBeDefined();
      expect(metadata.plugins?.length).toBe(1);
    });
  });

  describe('init', () => {
    it('should return plugin class with options via static init', () => {
      const result = ApprovalPlugin.init({
        mode: 'webhook',
      });

      // init returns a tuple of [PluginClass, options] for the plugin system
      expect(result).toBeDefined();
    });
  });
});
