// file: plugins/plugin-dashboard/src/__tests__/dashboard.plugin.test.ts

import 'reflect-metadata';
import DashboardPlugin from '../dashboard.plugin';
import { DashboardConfigToken } from '../dashboard.symbol';

describe('DashboardPlugin', () => {
  describe('constructor', () => {
    it('should create plugin with default options', () => {
      const plugin = new DashboardPlugin();

      expect(plugin.options).toBeDefined();
      expect(plugin.options.basePath).toBe('/dashboard');
      expect(plugin.options.auth.enabled).toBe(false);
    });

    it('should create plugin with custom basePath', () => {
      const plugin = new DashboardPlugin({ basePath: '/admin' });

      expect(plugin.options.basePath).toBe('/admin');
    });

    it('should create plugin with auth enabled', () => {
      const plugin = new DashboardPlugin({
        auth: { enabled: true, token: 'my-secret' },
      });

      expect(plugin.options.auth.enabled).toBe(true);
      expect(plugin.options.auth.token).toBe('my-secret');
    });

    it('should create plugin with custom cdn config', () => {
      const plugin = new DashboardPlugin({
        cdn: { react: 'https://custom.cdn/react' },
      });

      expect(plugin.options.cdn.react).toBe('https://custom.cdn/react');
    });

    it('should create plugin with enabled flag', () => {
      const plugin = new DashboardPlugin({ enabled: true });
      expect(plugin.options.enabled).toBe(true);
    });

    it('should merge options with defaults', () => {
      const plugin = new DashboardPlugin({
        basePath: '/custom',
        // auth and cdn should get defaults
      });

      expect(plugin.options.basePath).toBe('/custom');
      expect(plugin.options.auth).toBeDefined();
      expect(plugin.options.cdn).toBeDefined();
    });
  });

  describe('dynamicProviders', () => {
    it('should return providers with config token', () => {
      const providers = DashboardPlugin.dynamicProviders({});

      expect(providers.length).toBe(1);
      expect(providers[0].provide).toBe(DashboardConfigToken);
      expect(providers[0].name).toBe('dashboard:config');
    });

    it('should include parsed options in provider value', () => {
      const providers = DashboardPlugin.dynamicProviders({
        basePath: '/admin',
        auth: { enabled: true, token: 'secret' },
      });

      const configProvider = providers[0];
      expect(configProvider.useValue.basePath).toBe('/admin');
      expect(configProvider.useValue.auth.enabled).toBe(true);
      expect(configProvider.useValue.auth.token).toBe('secret');
    });

    it('should apply defaults to empty options', () => {
      const providers = DashboardPlugin.dynamicProviders({});

      const configProvider = providers[0];
      expect(configProvider.useValue.basePath).toBe('/dashboard');
      expect(configProvider.useValue.auth.enabled).toBe(false);
    });

    it('should parse cdn options with defaults', () => {
      const providers = DashboardPlugin.dynamicProviders({
        cdn: { react: 'https://custom.cdn/react' },
      });

      const configProvider = providers[0];
      expect(configProvider.useValue.cdn.react).toBe('https://custom.cdn/react');
      expect(configProvider.useValue.cdn.reactDom).toBe('https://esm.sh/react-dom@19');
    });
  });
});
