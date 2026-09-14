// server/__tests__/server.instance.spec.ts

import { type FrontMcpServer } from '../../common';
import { FrontMcpServerInstance } from '../server.instance';

// Capture constructor args passed to ExpressHostAdapter
let capturedAdapterArgs: unknown[] = [];
let capturedStartArgs: unknown[] = [];

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
      async start(...args: unknown[]) {
        capturedStartArgs = args;
      }
    },
  };
});

describe('FrontMcpServerInstance', () => {
  beforeEach(() => {
    capturedAdapterArgs = [];
    capturedStartArgs = [];
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

  describe('listener passed to start() (GHSA-mc9g-v2cp-vfff)', () => {
    // The adapter derives its default Host allow-list from the arguments
    // `start()` is called with — the listener it actually opens — so those have
    // to be the resolved ones. Predicting them at construction instead left a
    // direct caller's loopback listener unprotected.
    it('starts on the resolved bind address and port', async () => {
      await new FrontMcpServerInstance({ port: 3001, entryPath: '' }).start();

      expect(capturedStartArgs).toEqual([3001, '127.0.0.1']);
    });

    it('starts on the socket path instead of a port for a unix-socket server', async () => {
      await new FrontMcpServerInstance({ port: 3001, entryPath: '', socketPath: '/tmp/frontmcp.sock' }).start();

      expect(capturedStartArgs[0]).toBe('/tmp/frontmcp.sock');
    });

    it('honours an explicit bind address override', async () => {
      await new FrontMcpServerInstance({ port: 3001, entryPath: '', security: { bindAddress: 'all' } }).start();

      expect(capturedStartArgs).toEqual([3001, '0.0.0.0']);
    });

    it('does not hand the adapter a predicted listener', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '' });

      expect(capturedAdapterArgs[0]).not.toHaveProperty('listen.bindAddress');
      expect(capturedAdapterArgs[0]).not.toHaveProperty('listen.port');
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
