// server/__tests__/server.instance.test.ts

import { FrontMcpServerInstance } from '../server.instance';
import { FrontMcpServer } from '../../common';

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
    it('should pass default permissive CORS when cors is not specified', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '' });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toEqual({
        cors: { origin: true, credentials: true },
      });
    });

    it('should pass no options when cors is false', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: false });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toBeUndefined();
    });

    it('should pass custom cors config through to adapter', () => {
      const customCors = { origin: 'https://example.com', credentials: true, maxAge: 600 };
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: customCors });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toEqual({ cors: customCors });
    });

    it('should pass empty cors object through to adapter', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: {} });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toEqual({ cors: {} });
    });

    it('should pass cors with array of origins', () => {
      const customCors = { origin: ['https://a.com', 'https://b.com'] };
      new FrontMcpServerInstance({ port: 3001, entryPath: '', cors: customCors });

      expect(capturedAdapterArgs).toHaveLength(1);
      expect(capturedAdapterArgs[0]).toEqual({ cors: customCors });
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
