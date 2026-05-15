import * as http from 'node:http';

import { ExpressHostAdapter } from '../express.host.adapter';

// server/adapters/__tests__/express.host.adapter.spec.ts

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

  describe('body-parser limit (issue #410)', () => {
    type AddrInfo = { port: number; address: string; family: string };

    type TestResponse = { json: (payload: { size: number }) => void };
    const startServer = async (adapter: ExpressHostAdapter): Promise<{ url: string; close: () => Promise<void> }> => {
      adapter.registerRoute('POST', '/echo', (req: unknown, res: unknown) => {
        const body = (req as { body: unknown }).body;
        (res as TestResponse).json({ size: JSON.stringify(body).length });
      });
      const server = http.createServer(adapter.getHandler() as http.RequestListener);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as AddrInfo;
      return {
        url: `http://127.0.0.1:${addr.port}/echo`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    };

    const post = async (
      url: string,
      payload: string,
      contentType: string,
    ): Promise<{ status: number; body: unknown }> => {
      const { hostname, port, pathname } = new URL(url);
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            method: 'POST',
            hostname,
            port,
            path: pathname,
            headers: { 'content-type': contentType, 'content-length': Buffer.byteLength(payload) },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c as Buffer));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf-8');
              let body: unknown = raw;
              try {
                body = JSON.parse(raw);
              } catch {
                /* leave raw */
              }
              resolve({ status: res.statusCode ?? 0, body });
            });
          },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    };

    const postJson = (url: string, payload: string) => post(url, payload, 'application/json');
    const postForm = (url: string, payload: string) => post(url, payload, 'application/x-www-form-urlencoded');

    it('accepts a small body under the default limit', async () => {
      const adapter = new ExpressHostAdapter();
      const { url, close } = await startServer(adapter);
      try {
        const payload = JSON.stringify({ msg: 'x'.repeat(1024) });
        const { status, body } = await postJson(url, payload);
        expect(status).toBe(200);
        expect(body).toMatchObject({ size: expect.any(Number) });
      } finally {
        await close();
      }
    });

    it('accepts a 1MB body under the default 4mb limit (locks in the new default — regression for issue #410)', async () => {
      const adapter = new ExpressHostAdapter();
      const { url, close } = await startServer(adapter);
      try {
        // 1MB of JSON payload — well above the old 100KB body-parser default,
        // comfortably under the new 4MB default.
        const payload = JSON.stringify({ blob: 'A'.repeat(1024 * 1024) });
        const { status } = await postJson(url, payload);
        expect(status).toBe(200);
      } finally {
        await close();
      }
    });

    it('rejects a body over the configured limit with a structured JSON-RPC 413 envelope', async () => {
      const adapter = new ExpressHostAdapter({ bodyLimit: '10kb' });
      const { url, close } = await startServer(adapter);
      try {
        const payload = JSON.stringify({ blob: 'A'.repeat(50 * 1024) });
        const { status, body } = await postJson(url, payload);
        expect(status).toBe(413);
        expect(body).toMatchObject({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Payload Too Large',
            data: { limit: expect.any(Number), length: expect.any(Number) },
          },
        });
      } finally {
        await close();
      }
    });

    it('honors a custom raised bodyLimit', async () => {
      // 200KB request body; default would have rejected anything past 100KB,
      // and our new 4mb default accepts it — but here we explicitly set a
      // tighter limit of 500kb to prove the option is honored.
      const adapter = new ExpressHostAdapter({ bodyLimit: '500kb' });
      const { url, close } = await startServer(adapter);
      try {
        const payload = JSON.stringify({ blob: 'A'.repeat(200 * 1024) });
        const { status } = await postJson(url, payload);
        expect(status).toBe(200);
      } finally {
        await close();
      }
    });

    it('uses urlencodedLimit independently from bodyLimit when both are set', async () => {
      // Confirm urlencodedLimit is actually consumed by exercising the
      // urlencoded parser (Content-Type: application/x-www-form-urlencoded).
      // The form payload sits between urlencodedLimit (1kb) and bodyLimit
      // (500kb) — the urlencoded parser must 413 it. If urlencodedLimit
      // wiring regresses (falls back to bodyLimit's 500kb), this test fails.
      const adapter = new ExpressHostAdapter({ bodyLimit: '500kb', urlencodedLimit: '1kb' });
      const { url, close } = await startServer(adapter);
      try {
        // ~5kb form payload — well over urlencodedLimit, well under bodyLimit.
        const payload = `blob=${'A'.repeat(5 * 1024)}`;
        const { status, body } = await postForm(url, payload);
        expect(status).toBe(413);
        expect(body).toMatchObject({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Payload Too Large' },
        });
      } finally {
        await close();
      }
    });

    it('runs CORS middleware before body parsers for oversized payloads (CodeRabbit PR #422)', async () => {
      // Regression: CORS middleware previously ran AFTER body parsers, so a
      // body-too-large 413 short-circuited to our error handler without ever
      // hitting CORS — and browsers refused to surface the structured
      // JSON-RPC error body to client JS.
      //
      // The `cors` module is mocked above so `mockCorsMiddleware` is the
      // actual middleware installed in the Express stack. If CORS is ordered
      // BEFORE the body parsers, an oversized request still hits the cors
      // middleware (which calls next()) before the parser throws
      // entity.too.large. If CORS regresses back to after the parsers, the
      // parser rejects first and the cors middleware is NEVER invoked.
      const adapter = new ExpressHostAdapter({
        bodyLimit: '10kb',
        cors: { origin: 'https://example.com', credentials: false },
      });
      const { url, close } = await startServer(adapter);
      try {
        const payload = JSON.stringify({ blob: 'A'.repeat(50 * 1024) });
        const { status } = await postJson(url, payload);
        // Parser still rejects oversized body with 413.
        expect(status).toBe(413);
        // CORS factory was wired exactly once with our explicit origin…
        expect(corsCalls).toHaveLength(1);
        expect(corsCalls[0]).toMatchObject({ origin: 'https://example.com', credentials: false });
        // …and crucially, the CORS middleware actually ran on the oversized
        // request before the body parser rejected it. If the order regresses,
        // this expectation fails because the parser short-circuits to the
        // 413 error handler without invoking subsequent middleware.
        expect(mockCorsMiddleware).toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });
});
