// file: plugins/plugin-dashboard/src/__tests__/dashboard.app.spec.ts

import 'reflect-metadata';

import { DashboardApp, DashboardHttpPlugin } from '../app/dashboard.app';
import { publishDashboardOptions, resetDashboardOptions } from '../dashboard.config-store';
import { DashboardConfigToken } from '../dashboard.symbol';
import { dashboardPluginOptionsSchema, type DashboardPluginOptions } from '../dashboard.types';

type DynamicProvider = { name?: string; provide?: unknown; inject?: unknown; useFactory?: unknown };

/** Run the config provider's factory — the config is resolved lazily. */
function resolveConfig(providers: DynamicProvider[]): DashboardPluginOptions {
  const provider = providers.find((p) => p.provide === DashboardConfigToken);
  return (provider as { useFactory: () => DashboardPluginOptions }).useFactory();
}

describe('DashboardApp', () => {
  describe('class export', () => {
    it('should export DashboardApp class', () => {
      expect(DashboardApp).toBeDefined();
      expect(typeof DashboardApp).toBe('function');
    });

    it('should be a class constructor', () => {
      const app = new DashboardApp();
      expect(app).toBeInstanceOf(DashboardApp);
    });
  });
});

describe('DashboardHttpPlugin', () => {
  describe('constructor', () => {
    it('should create plugin with default options', () => {
      const plugin = new DashboardHttpPlugin();

      expect(plugin.options).toBeDefined();
      expect(plugin.options.basePath).toBe('/dashboard');
      expect(plugin.options.auth.enabled).toBe(false);
    });

    it('should create plugin with custom basePath', () => {
      const plugin = new DashboardHttpPlugin({ basePath: '/admin' });

      expect(plugin.options.basePath).toBe('/admin');
    });

    it('should create plugin with auth enabled', () => {
      const plugin = new DashboardHttpPlugin({
        auth: { enabled: true, token: 'secret' },
      });

      expect(plugin.options.auth.enabled).toBe(true);
      expect(plugin.options.auth.token).toBe('secret');
    });

    it('should create plugin with custom cdn config', () => {
      const plugin = new DashboardHttpPlugin({
        cdn: { react: 'https://custom.cdn/react' },
      });

      expect(plugin.options.cdn.react).toBe('https://custom.cdn/react');
    });

    it('should merge options with defaults', () => {
      const plugin = new DashboardHttpPlugin({
        basePath: '/custom',
      });

      expect(plugin.options.basePath).toBe('/custom');
      expect(plugin.options.auth).toBeDefined();
      expect(plugin.options.cdn).toBeDefined();
    });
  });

  describe('dynamicProviders', () => {
    it('should return array of providers', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});

      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(1);
    });

    it('should include config provider', () => {
      const providers: DynamicProvider[] = DashboardHttpPlugin.dynamicProviders({});

      const configProvider = providers.find((p) => p.provide === DashboardConfigToken);
      expect(configProvider).toBeDefined();
      expect(configProvider?.name).toBe('dashboard:config');
    });

    // GHSA-rgxj-434m-vxh3: the config is resolved in a FACTORY, not baked into a
    // `useValue`. `DashboardApp` declares this plugin inside an `@App` decorator
    // that runs at module-import time — before `DashboardPlugin.init(...)` is
    // evaluated — so an eagerly-parsed value would always be the defaults, which
    // is how the operator's `auth` and `basePath` came to be discarded.
    it('resolves the config lazily, in a factory', () => {
      const providers: DynamicProvider[] = DashboardHttpPlugin.dynamicProviders({
        basePath: '/admin',
        auth: { enabled: true, token: 'test' },
      });

      const configProvider = providers.find((p) => p.provide === DashboardConfigToken);
      expect(configProvider).toBeDefined();
      expect(typeof (configProvider as { useFactory?: unknown }).useFactory).toBe('function');

      const resolved = (
        configProvider as { useFactory: () => { basePath: string; auth: { enabled: boolean } } }
      ).useFactory();
      expect(resolved.basePath).toBe('/admin');
      expect(resolved.auth.enabled).toBe(true);
    });

    it('registers no page middleware: the page is DashboardPageRoute', () => {
      const providers: DynamicProvider[] = DashboardHttpPlugin.dynamicProviders({});

      expect(providers.map((p) => p.name)).toEqual(['dashboard:config']);
    });

    it('should apply defaults when options are empty', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});

      const resolved = resolveConfig(providers);
      expect(resolved.basePath).toBe('/dashboard');
      expect(resolved.auth.enabled).toBe(false);
    });

    it('should parse cdn options with defaults', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({
        cdn: { react: 'https://custom.cdn/react' },
      });

      const resolved = resolveConfig(providers);
      expect(resolved.cdn.react).toBe('https://custom.cdn/react');
      expect(resolved.cdn.reactDom).toBe('https://esm.sh/react-dom@19');
    });

    it('REFUSES a second, different auth configuration in one process', () => {
      // The store is process-wide. Accepting it would make one server's token
      // valid on another's dashboard, invisibly — worse than failing to boot.
      try {
        publishDashboardOptions(dashboardPluginOptionsSchema.parse({ auth: { enabled: true, token: 'first' } }));

        expect(() =>
          publishDashboardOptions(dashboardPluginOptionsSchema.parse({ auth: { enabled: true, token: 'second' } })),
        ).toThrow(/AUTH configuration/);
      } finally {
        resetDashboardOptions();
      }
    });

    it('refuses a second configuration that only turns auth off', () => {
      try {
        publishDashboardOptions(dashboardPluginOptionsSchema.parse({ auth: { enabled: true, token: 'first' } }));

        expect(() => publishDashboardOptions(dashboardPluginOptionsSchema.parse({}))).toThrow(/AUTH configuration/);
      } finally {
        resetDashboardOptions();
      }
    });

    it('warns when only the CDN settings differ', () => {
      // `generateDashboardHtml` builds its script URLs and external entrypoint
      // from `cdn`, so a silent swap serves one server's page with another's CDN.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        publishDashboardOptions(dashboardPluginOptionsSchema.parse({ cdn: { react: 'https://a.example/react' } }));
        publishDashboardOptions(dashboardPluginOptionsSchema.parse({ cdn: { react: 'https://b.example/react' } }));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('process-wide'));
      } finally {
        warn.mockRestore();
        resetDashboardOptions();
      }
    });

    it('does not warn when the same configuration is published twice', () => {
      // `init()` publishes from both the constructor and dynamicProviders.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const parsed = dashboardPluginOptionsSchema.parse({ auth: { enabled: true, token: 'same' } });
        publishDashboardOptions(parsed);
        publishDashboardOptions(parsed);

        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
        resetDashboardOptions();
      }
    });

    it('prefers the options the operator gave DashboardPlugin over the app-declared {}', () => {
      // The real-world shape: `DashboardApp` declares `init({})`, and the
      // operator configures `DashboardPlugin` separately.
      publishDashboardOptions(
        dashboardPluginOptionsSchema.parse({ basePath: '/ops', auth: { enabled: true, token: 'operator-token' } }),
      );
      try {
        const resolved = resolveConfig(DashboardHttpPlugin.dynamicProviders({}));
        expect(resolved.basePath).toBe('/ops');
        expect(resolved.auth.token).toBe('operator-token');
      } finally {
        resetDashboardOptions();
      }
    });
  });
});
