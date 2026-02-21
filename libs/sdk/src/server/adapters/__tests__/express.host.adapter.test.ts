// server/adapters/__tests__/express.host.adapter.test.ts

// Mock base.host.adapter to break the import chain into ../../common (which pulls @frontmcp/auth)
jest.mock('../base.host.adapter', () => {
  class HostServerAdapter {
    registerRoute(..._args: unknown[]) {}
    registerMiddleware(..._args: unknown[]) {}
    enhancedHandler(handler: unknown) {
      return handler;
    }
    prepare() {}
    getHandler() {
      return {};
    }
    async start() {}
  }
  return { HostServerAdapter };
});

// Track calls to the cors middleware factory
let corsCalls: unknown[] = [];
const mockCorsMiddleware = jest.fn((_req: unknown, _res: unknown, next: () => void) => next());

jest.mock('cors', () => {
  return jest.fn((options: unknown) => {
    corsCalls.push(options);
    return mockCorsMiddleware;
  });
});

import { ExpressHostAdapter } from '../express.host.adapter';
import * as http from 'node:http';

describe('ExpressHostAdapter', () => {
  beforeEach(() => {
    corsCalls = [];
    mockCorsMiddleware.mockClear();
    (require('cors') as jest.Mock).mockClear();
  });

  describe('CORS configuration', () => {
    it('should not enable cors middleware when no options are provided', () => {
      new ExpressHostAdapter();

      expect(corsCalls).toHaveLength(0);
    });

    it('should not enable cors middleware when cors option is omitted', () => {
      new ExpressHostAdapter({});

      expect(corsCalls).toHaveLength(0);
    });

    it('should enable cors middleware with origin: true', () => {
      new ExpressHostAdapter({ cors: { origin: true, credentials: true } });

      expect(corsCalls).toHaveLength(1);
      expect(corsCalls[0]).toEqual({
        origin: true,
        credentials: true,
        maxAge: 300,
      });
    });

    it('should enable cors middleware with specific origin string', () => {
      new ExpressHostAdapter({
        cors: { origin: 'https://example.com', credentials: true, maxAge: 600 },
      });

      expect(corsCalls).toHaveLength(1);
      expect(corsCalls[0]).toEqual({
        origin: 'https://example.com',
        credentials: true,
        maxAge: 600,
      });
    });

    it('should enable cors middleware with array of origins', () => {
      new ExpressHostAdapter({
        cors: { origin: ['https://a.com', 'https://b.com'] },
      });

      expect(corsCalls).toHaveLength(1);
      expect(corsCalls[0]).toEqual({
        origin: ['https://a.com', 'https://b.com'],
        credentials: false,
        maxAge: 300,
      });
    });

    it('should enable cors middleware with origin function', () => {
      const originFn = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        cb(null, true);
      };
      new ExpressHostAdapter({ cors: { origin: originFn } });

      expect(corsCalls).toHaveLength(1);
      expect((corsCalls[0] as Record<string, unknown>).origin).toBe(originFn);
    });

    it('should not enable cors middleware when origin is false', () => {
      new ExpressHostAdapter({ cors: { origin: false } });

      expect(corsCalls).toHaveLength(0);
    });

    it('should not enable cors middleware when origin is undefined', () => {
      new ExpressHostAdapter({ cors: { credentials: true } });

      expect(corsCalls).toHaveLength(0);
    });

    it('should default credentials to false when not specified', () => {
      new ExpressHostAdapter({ cors: { origin: true } });

      expect(corsCalls).toHaveLength(1);
      expect((corsCalls[0] as Record<string, unknown>).credentials).toBe(false);
    });

    it('should default maxAge to 300 when not specified', () => {
      new ExpressHostAdapter({ cors: { origin: true } });

      expect(corsCalls).toHaveLength(1);
      expect((corsCalls[0] as Record<string, unknown>).maxAge).toBe(300);
    });
  });

  describe('response headers', () => {
    it('should expose Mcp-Session-Id in Access-Control-Expose-Headers when CORS is enabled', async () => {
      const adapter = new ExpressHostAdapter({ cors: { origin: true } });
      adapter.registerRoute('GET', '/test', (_req: unknown, res: any) => {
        res.status(200).json({ ok: true });
      });
      const app = adapter.getHandler();
      const server = http.createServer(app);

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const response = await new Promise<any>((resolve, reject) => {
          http.get(`http://127.0.0.1:${port}/test`, (res: any) => resolve(res)).on('error', reject);
        });

        const exposeHeaders = response.headers['access-control-expose-headers'];
        expect(exposeHeaders).toContain('Mcp-Session-Id');
        expect(exposeHeaders).toContain('WWW-Authenticate');
      } finally {
        await new Promise<void>((resolve) => server.close(resolve));
      }
    });

    it('should not set Access-Control-Expose-Headers when CORS is disabled', async () => {
      const adapter = new ExpressHostAdapter();
      adapter.registerRoute('GET', '/test', (_req: unknown, res: any) => {
        res.status(200).json({ ok: true });
      });
      const app = adapter.getHandler();
      const server = http.createServer(app);

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const response = await new Promise<any>((resolve, reject) => {
          http.get(`http://127.0.0.1:${port}/test`, (res: any) => resolve(res)).on('error', reject);
        });

        const exposeHeaders = response.headers['access-control-expose-headers'];
        expect(exposeHeaders).toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => server.close(resolve));
      }
    });
  });

  describe('route registration', () => {
    it('should register routes with the correct method and path', () => {
      const adapter = new ExpressHostAdapter();
      const handler = jest.fn();

      // Should not throw
      adapter.registerRoute('GET', '/test', handler);
      adapter.registerRoute('POST', '/submit', handler);
    });

    it('should register middleware', () => {
      const adapter = new ExpressHostAdapter();
      const handler = jest.fn();

      adapter.registerMiddleware('/api', handler);
    });
  });

  describe('getHandler()', () => {
    it('should return the Express application', () => {
      const adapter = new ExpressHostAdapter();
      const handler = adapter.getHandler();

      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should call prepare() automatically', () => {
      const adapter = new ExpressHostAdapter();
      const prepareSpy = jest.spyOn(adapter, 'prepare');

      adapter.getHandler();

      expect(prepareSpy).toHaveBeenCalled();
    });
  });

  describe('prepare()', () => {
    it('should be idempotent', () => {
      const adapter = new ExpressHostAdapter();

      // Should not throw when called multiple times
      adapter.prepare();
      adapter.prepare();
    });
  });
});
