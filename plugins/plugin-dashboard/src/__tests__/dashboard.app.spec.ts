// file: plugins/plugin-dashboard/src/__tests__/dashboard.app.spec.ts

import 'reflect-metadata';

import { DashboardApp, DashboardHttpPlugin } from '../app/dashboard.app';
import { publishDashboardOptions, resetDashboardOptions } from '../dashboard.config-store';
import { DashboardConfigToken } from '../dashboard.symbol';
import { dashboardPluginOptionsSchema, type DashboardPluginOptions } from '../dashboard.types';

/** Run the config provider's factory — the config is resolved lazily. */
function resolveConfig(providers: Array<{ provide?: unknown; useFactory?: unknown }>): DashboardPluginOptions {
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
      const providers = DashboardHttpPlugin.dynamicProviders({});

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
      const providers = DashboardHttpPlugin.dynamicProviders({
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

    it('should include middleware provider', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});

      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware');
      expect(middlewareProvider).toBeDefined();
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

describe('Dashboard middleware', () => {
  describe('middleware provider factory', () => {
    it('should have inject function that requests FrontMcpServer', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware');

      expect(middlewareProvider?.inject).toBeDefined();
      expect(typeof middlewareProvider?.inject).toBe('function');
    });

    it('should have useFactory function', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware');

      expect(middlewareProvider?.useFactory).toBeDefined();
      expect(typeof middlewareProvider?.useFactory).toBe('function');
    });

    it('should register middleware when factory is called', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ basePath: '/dash' });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      const mockServer = {
        registerMiddleware: jest.fn(),
      };

      const result = middlewareProvider.useFactory(mockServer);

      expect(result).toEqual({ registered: true });
      expect(mockServer.registerMiddleware).toHaveBeenCalledWith('/dash', expect.any(Function));
    });

    it('should create middleware that serves HTML for GET /', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);
      expect(capturedMiddleware).not.toBeNull();

      // Test GET / request
      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      await capturedMiddleware!({ method: 'GET', path: '/' }, mockRes, next);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass through non-GET requests', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      await capturedMiddleware!({ method: 'POST', path: '/' }, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockRes.send).not.toHaveBeenCalled();
    });

    it('should pass through non-root paths', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      await capturedMiddleware!({ method: 'GET', path: '/api' }, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockRes.send).not.toHaveBeenCalled();
    });

    it('should call next when dashboard is disabled', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: false });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      await capturedMiddleware!({ method: 'GET', path: '/' }, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockRes.send).not.toHaveBeenCalled();
    });

    it('should handle empty path and url', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      // Request with empty path/url
      await capturedMiddleware!({ method: 'GET', path: '' }, mockRes, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('should use url when path is not available', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      // Request with url instead of path
      await capturedMiddleware!({ method: 'GET', url: '/' }, mockRes, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should default method to GET when not provided', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      // Request without method (should default to GET)
      await capturedMiddleware!({ path: '/' }, mockRes, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should work without setHeader method', async () => {
      const providers = DashboardHttpPlugin.dynamicProviders({ enabled: true });
      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware') as {
        useFactory: (server: unknown) => { registered: boolean };
      };

      let capturedMiddleware: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      const mockServer = {
        registerMiddleware: jest.fn((_path: string, mw: typeof capturedMiddleware) => {
          capturedMiddleware = mw;
        }),
      };

      middlewareProvider.useFactory(mockServer);

      // Response without setHeader method
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      // Should not throw when setHeader is not available
      await capturedMiddleware!({ method: 'GET', path: '/' }, mockRes, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalled();
    });
  });
});
