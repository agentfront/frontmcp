// file: plugins/plugin-dashboard/src/__tests__/dashboard.app.test.ts

import 'reflect-metadata';
import { DashboardApp, DashboardHttpPlugin } from '../app/dashboard.app';
import { DashboardConfigToken } from '../dashboard.symbol';
import { dashboardPluginOptionsSchema } from '../dashboard.types';

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

    it('should include parsed options in config provider', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({
        basePath: '/admin',
        auth: { enabled: true, token: 'test' },
      });

      const configProvider = providers.find((p) => p.provide === DashboardConfigToken);
      expect(configProvider?.useValue.basePath).toBe('/admin');
      expect(configProvider?.useValue.auth.enabled).toBe(true);
    });

    it('should include middleware provider', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});

      const middlewareProvider = providers.find((p) => p.name === 'dashboard:middleware');
      expect(middlewareProvider).toBeDefined();
    });

    it('should apply defaults when options are empty', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({});

      const configProvider = providers.find((p) => p.provide === DashboardConfigToken);
      expect(configProvider?.useValue.basePath).toBe('/dashboard');
      expect(configProvider?.useValue.auth.enabled).toBe(false);
    });

    it('should parse cdn options with defaults', () => {
      const providers = DashboardHttpPlugin.dynamicProviders({
        cdn: { react: 'https://custom.cdn/react' },
      });

      const configProvider = providers.find((p) => p.provide === DashboardConfigToken);
      expect(configProvider?.useValue.cdn.react).toBe('https://custom.cdn/react');
      expect(configProvider?.useValue.cdn.reactDom).toBe('https://esm.sh/react-dom@19');
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
