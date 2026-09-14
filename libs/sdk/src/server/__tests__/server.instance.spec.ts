// server/__tests__/server.instance.spec.ts

import { type FrontMcpServer } from '../../common';
import { FrontMcpServerInstance } from '../server.instance';

// Capture constructor args passed to ExpressHostAdapter
let capturedAdapterArgs: unknown[] = [];

jest.mock('../adapters/express.host.adapter', () => {
  return {
    ExpressHostAdapter: class MockExpressHostAdapter {
      constructor(...args: unknown[]) {
        capturedAdapterArgs = args;
      }
      registerRoute() {}
      registerMiddleware() {}
      enhancedHandler(handler: unknown) {
        return handler;
      }
      prepare() {}
      getHandler() {
        return {};
      }
      async start() {}
    },
  };
});

describe('FrontMcpServerInstance', () => {
  beforeEach(() => {
    capturedAdapterArgs = [];
  });

  describe('CORS resolution in setupDefaults', () => {
    // BREAKING in v1.x: the default was `{ origin: true, credentials: false }` — any Origin
    // reflected, so any page the user visited could read a local server's responses. A server that
    // wants cross-origin browser access now says so.
    it('sends NO CORS headers when cors is not specified — same-origin only', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '' });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).not.toHaveProperty('cors');
    });

    it('still honours an explicit permissive CORS config — the way back', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: { origin: true } });

      expect(capturedAdapterArgs[0]).toMatchObject({ cors: { origin: true } });
    });

    it('should pass empty options when cors is false', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: false });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).not.toHaveProperty('cors');
    });

    it('should pass custom cors config through to adapter', () => {
      const customCors = { origin: 'https://example.com', credentials: true, maxAge: 600 };
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: customCors });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toMatchObject({ cors: customCors });
    });

    it('should pass empty cors object through to adapter', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: {} });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toMatchObject({ cors: {} });
    });

    it('should pass cors with array of origins', () => {
      const customCors = { origin: ['https://a.com', 'https://b.com'] };
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: customCors });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toMatchObject({ cors: customCors });
    });
  });

  describe('listen info for DNS-rebinding protection (GHSA-mc9g-v2cp-vfff)', () => {
    // The adapter derives its default Host allow-list from what the server will
    // actually listen on, so that information has to reach it.
    it('forwards the resolved bind address and port', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '' });

      expect(capturedAdapterArgs[0]).toMatchObject({ listen: { bindAddress: '127.0.0.1', port: 3001 } });
    });

    it('forwards the socket path instead of a port for a unix-socket server', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', socketPath: '/tmp/frontmcp.sock' });

      expect(capturedAdapterArgs[0]).toMatchObject({ listen: { socketPath: '/tmp/frontmcp.sock' } });
      expect((capturedAdapterArgs[0] as { listen: Record<string, unknown> }).listen).not.toHaveProperty('port');
    });

    it('forwards an explicit bind address override', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', security: { bindAddress: 'all' } });

      expect(capturedAdapterArgs[0]).toMatchObject({ listen: { bindAddress: '0.0.0.0' } });
    });
  });

  describe('hostFactory takes precedence over cors', () => {
    it('should use hostFactory function when provided', () => {
      const mockHost = {
        registerRoute: jest.fn(),
        registerMiddleware: jest.fn(),
        enhancedHandler: jest.fn((h: unknown) => h),
        prepare: jest.fn(),
        getHandler: jest.fn(),
        start: jest.fn(),
      };
      const factory = jest.fn().mockReturnValue(mockHost);

      const instance = new FrontMcpServerInstance({
        port: 3001,
        entryPath: '',
        hostFactory: factory,
        cors: { origin: 'https://example.com' },
      });

      expect(factory).toHaveBeenCalledWith(expect.objectContaining({ port: 3001, entryPath: '' }));
      // hostFactory args should not include hostFactory itself
      expect(factory).toHaveBeenCalledWith(expect.not.objectContaining({ hostFactory: expect.anything() }));
      // ExpressHostAdapter should not have been instantiated
      expect(capturedAdapterArgs).toHaveLength(0);
      expect(instance.host).toBe(mockHost);
    });

    it('should use hostFactory instance when provided', () => {
      const mockHost = {
        registerRoute: jest.fn(),
        registerMiddleware: jest.fn(),
        enhancedHandler: jest.fn((h: unknown) => h),
        prepare: jest.fn(),
        getHandler: jest.fn(),
        start: jest.fn(),
      };

      const instance = new FrontMcpServerInstance({
        port: 3001,
        entryPath: '',
        hostFactory: mockHost as unknown as FrontMcpServer,
      });

      // ExpressHostAdapter should not have been instantiated
      expect(capturedAdapterArgs).toHaveLength(0);
      expect(instance.host).toBe(mockHost);
    });
  });

  describe('registerRoute delegation (custom http.routes plumbing)', () => {
    it('delegates registerRoute to the host adapter', () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '' });
      const spy = jest.spyOn(instance.host, 'registerRoute');
      const handler = jest.fn();

      instance.registerRoute('GET', '/download/:id', handler);

      expect(spy).toHaveBeenCalledWith('GET', '/download/:id', handler);
    });

    it('accepts a routes array in config without affecting host construction', () => {
      // routes are registered from the scope, not the server instance — the
      // server simply carries them through on `config`.
      const handler = jest.fn();
      const instance = new FrontMcpServerInstance({
        port: 3001,
        entryPath: '',
        routes: [{ method: 'GET', path: '/ping', handler }],
      });

      expect(instance.config.routes).toHaveLength(1);
      expect(instance.config.routes?.[0]).toMatchObject({ method: 'GET', path: '/ping' });
      // Adapter constructed with no CORS options at all (the same-origin default).
      expect(capturedAdapterArgs[0]).not.toHaveProperty('cors');
    });
  });

  describe('health endpoint', () => {
    it('should register health route on prepare()', () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '' });
      const registerSpy = jest.spyOn(instance.host, 'registerRoute');

      instance.prepare();

      expect(registerSpy).toHaveBeenCalledWith('GET', '/health', expect.any(Function));
    });

    it('should register health route only once on multiple prepare() calls', () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '' });
      const registerSpy = jest.spyOn(instance.host, 'registerRoute');

      instance.prepare();
      instance.prepare();

      expect(registerSpy).toHaveBeenCalledTimes(1);
    });
  });
});
