// server/__tests__/server.instance.spec.ts

import { isProduction } from '@frontmcp/utils';

import { type FrontMcpServer } from '../../common';
import { auditSecurityDefaults } from '../security/security-audit';
import { FrontMcpServerInstance } from '../server.instance';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, isProduction: jest.fn(actual.isProduction) };
});

jest.mock('../security/security-audit', () => {
  const actual = jest.requireActual('../security/security-audit');
  return { ...actual, auditSecurityDefaults: jest.fn(actual.auditSecurityDefaults), logSecurityFindings: jest.fn() };
});

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
      prepare() {}
      getHandler() {
        return {};
      }
      async start(...args: unknown[]) {
        capturedStartArgs = args;
        events.push('host:start');
      }
      async stop() {
        events.push('host:stop');
        if (hostStopFailure) throw hostStopFailure;
      }
    },
  };
});

// The node:http host stands in for the Express host when it can read the installed Express (#948); these specs
// cover the Express host, and the last describe the choice between the two.
const mockCreateNodeHttpHost = jest.fn((_options: unknown): unknown => undefined);
jest.mock('#node-http-host', () => ({ createNodeHttpHost: (options: unknown) => mockCreateNodeHttpHost(options) }));

let events: string[] = [];
let hostStopFailure: Error | undefined;
let userContentStartFailure: Error | undefined;
let capturedUserContent: { options: unknown; startArgs?: unknown[] } | undefined;

jest.mock('../adapters/user-content.listener', () => ({
  UserContentListener: class MockUserContentListener {
    constructor(options: unknown) {
      capturedUserContent = { options };
    }
    async start(...args: unknown[]) {
      events.push('userContent:start');
      if (capturedUserContent) capturedUserContent.startArgs = args;
      if (userContentStartFailure) throw userContentStartFailure;
    }
    async stop() {
      events.push('userContent:stop');
    }
  },
}));

describe('FrontMcpServerInstance', () => {
  beforeEach(() => {
    capturedAdapterArgs = [];
    capturedStartArgs = [];
    events = [];
    hostStopFailure = undefined;
    userContentStartFailure = undefined;
    capturedUserContent = undefined;
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

  describe('bodyLimit', () => {
    it('leaves the body limit to the host adapter when the config sets none', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '' });

      expect(capturedAdapterArgs[0]).not.toHaveProperty('bodyLimit');
    });

    it('passes a configured body limit to the host adapter', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '', bodyLimit: '512kb' });

      expect(capturedAdapterArgs[0]).toMatchObject({ bodyLimit: '512kb' });
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

    it('audits for production from the NODE_ENV the deployment sets, not a bundler-folded read', async () => {
      jest.mocked(isProduction).mockReturnValueOnce(true);

      await new FrontMcpServerInstance({ port: 3001, entryPath: '' }).start();

      expect(process.env['NODE_ENV']).not.toBe('production');
      expect(auditSecurityDefaults).toHaveBeenLastCalledWith(expect.any(Object), true);
    });

    it('does not hand the adapter a predicted listener', () => {
      new FrontMcpServerInstance({ port: 3001, entryPath: '' });

      expect(capturedAdapterArgs[0]).not.toHaveProperty('listen.bindAddress');
      expect(capturedAdapterArgs[0]).not.toHaveProperty('listen.port');
    });
  });

  describe('http.userContent (#1364)', () => {
    const userContent = { port: 3002, root: '/srv/content' };

    it('opens no user-content listener without the option', async () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '' });
      await instance.start();
      await instance.stop();

      expect(capturedUserContent).toBeUndefined();
      expect(events).toEqual(['host:start', 'host:stop']);
    });

    it('starts it after the MCP listener, told that listener, on the same bind address', async () => {
      await new FrontMcpServerInstance({
        port: 3001,
        entryPath: '',
        userContent,
        security: { bindAddress: 'all' },
      }).start();

      expect(capturedUserContent).toEqual({ options: userContent, startArgs: [3001, '0.0.0.0'] });
      expect(events).toEqual(['host:start', 'userContent:start']);
    });

    it('tells it the MCP socket path on a unix-socket server', async () => {
      await new FrontMcpServerInstance({ port: 3001, entryPath: '', socketPath: '/tmp/mcp.sock', userContent }).start();

      expect(capturedUserContent?.startArgs?.[0]).toBe('/tmp/mcp.sock');
    });

    it('starts it beside a hostFactory host too', async () => {
      const host = {
        prepare: jest.fn(),
        registerRoute: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        getHandler: jest.fn(),
      };
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '', hostFactory: host, userContent });
      await instance.start();
      await instance.stop();

      expect(host.start).toHaveBeenCalledWith(3001, '127.0.0.1');
      expect(events).toEqual(['userContent:start', 'userContent:stop']);
      expect(host.stop).toHaveBeenCalled();
    });

    it('does not build it for a serverless handler, which never starts', () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '', userContent });
      instance.prepare();
      instance.getHandler();

      expect(capturedUserContent).toBeUndefined();
    });

    it('fails start() when it cannot start', async () => {
      userContentStartFailure = new Error('EADDRINUSE');

      await expect(new FrontMcpServerInstance({ port: 3001, entryPath: '', userContent }).start()).rejects.toBe(
        userContentStartFailure,
      );
    });

    it('stops both listeners', async () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '', userContent });
      await instance.start();
      await instance.stop();

      expect(events).toEqual(['host:start', 'userContent:start', 'host:stop', 'userContent:stop']);
    });

    it('stops it even when the MCP host fails to stop, then reports that failure', async () => {
      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '', userContent });
      await instance.start();
      hostStopFailure = new Error('host stop failed');

      await expect(instance.stop()).rejects.toBe(hostStopFailure);
      expect(events).toContain('userContent:stop');
    });
  });

  describe('http.userContent with a hostFactory host whose stop() throws at once (#1364)', () => {
    it('still stops the content listener, then reports the host failure', async () => {
      const failure = new Error('host stop failed');
      const host = {
        prepare: jest.fn(),
        registerRoute: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(() => {
          throw failure;
        }),
        getHandler: jest.fn(),
      };
      const instance = new FrontMcpServerInstance({
        port: 3001,
        entryPath: '',
        hostFactory: host,
        userContent: { port: 3002, root: '/srv/content' },
      });
      await instance.start();

      await expect(instance.stop()).rejects.toBe(failure);
      expect(events).toContain('userContent:stop');
    });
  });

  describe('hostFactory takes precedence over cors', () => {
    it('should use hostFactory function when provided', () => {
      const mockHost = {
        registerRoute: jest.fn(),
        registerMiddleware: jest.fn(),
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

  describe('the host it runs on (#948)', () => {
    afterEach(() => {
      mockCreateNodeHttpHost.mockReset();
      mockCreateNodeHttpHost.mockImplementation(() => undefined);
    });

    it('runs on the node:http host when there is one, with the options the Express host would get', () => {
      const nodeHttpHost = { registerRoute: jest.fn(), registerMiddleware: jest.fn() };
      mockCreateNodeHttpHost.mockImplementation(() => nodeHttpHost);

      const instance = new FrontMcpServerInstance({ port: 3001, entryPath: '/mcp', bodyLimit: '8mb' } as never);

      expect(instance.host).toBe(nodeHttpHost);
      expect(capturedAdapterArgs).toEqual([]);
      expect(mockCreateNodeHttpHost).toHaveBeenCalledWith({
        publicCorsPaths: ['/mcp/server-card'],
        bodyLimit: '8mb',
      });
    });

    it('runs on the Express host when the node:http host cannot stand in for the installed Express', () => {
      const instance = new FrontMcpServerInstance({ port: 3001 } as never);

      expect(instance.host.constructor.name).toBe('MockExpressHostAdapter');
      expect(capturedAdapterArgs).toEqual([mockCreateNodeHttpHost.mock.calls[0][0]]);
    });
  });
});
