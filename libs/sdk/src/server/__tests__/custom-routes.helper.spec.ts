// server/__tests__/custom-routes.helper.spec.ts

import {
  httpRespond,
  type FrontMcpLogger,
  type HttpRouteConfig,
  type ServerRequest,
  type ServerResponse,
} from '../../common';
import {
  assertNotReserved,
  computeReservedPaths,
  registerCustomHttpRoutes,
  ReservedRouteCollisionError,
  wrapWithAuth,
  wrapWithIpFilter,
  type CheckClientIpFn,
  type VerifyResult,
} from '../custom-routes.helper';

function makeLogger(): FrontMcpLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as FrontMcpLogger;
}

function makeRes(): ServerResponse & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
} {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
    },
    send(payload: unknown) {
      this.body = payload;
    },
    end(payload?: unknown) {
      if (payload !== undefined) this.body = payload;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    getHeader(k: string) {
      return this.headers[k];
    },
    redirect() {},
  };
  return res as unknown as ServerResponse & { statusCode: number; body: unknown; headers: Record<string, string> };
}

describe('custom-routes.helper', () => {
  describe('computeReservedPaths', () => {
    it('reserves the root MCP base ("") plus /sse, /message, /health, /metrics', () => {
      const { exact, prefixes } = computeReservedPaths('', '');
      expect(exact.has('/')).toBe(true);
      expect(exact.has('/sse')).toBe(true);
      expect(exact.has('/message')).toBe(true);
      expect(exact.has('/health')).toBe(true);
      expect(exact.has('/metrics')).toBe(true);
      expect(prefixes).toEqual(['/oauth', '/.well-known']);
    });

    it('reserves the resolved entry path when entryPath="/mcp"', () => {
      const { exact } = computeReservedPaths('/mcp', '');
      expect(exact.has('/mcp')).toBe(true);
      expect(exact.has('/mcp/sse')).toBe(true);
      expect(exact.has('/mcp/message')).toBe(true);
    });

    it('reserves the split-by-app scope base (entryPath + routeBase)', () => {
      const { exact } = computeReservedPaths('/mcp', '/billing');
      expect(exact.has('/mcp/billing')).toBe(true);
      expect(exact.has('/mcp/billing/sse')).toBe(true);
      expect(exact.has('/mcp/billing/message')).toBe(true);
    });
  });

  describe('assertNotReserved', () => {
    const reserved = computeReservedPaths('/mcp', '');

    it('passes for a non-reserved custom path', () => {
      expect(() => assertNotReserved('GET', '/download/:id', reserved)).not.toThrow();
    });

    it('rejects the exact MCP entry path', () => {
      expect(() => assertNotReserved('POST', '/mcp', reserved)).toThrow(ReservedRouteCollisionError);
    });

    it('rejects /sse and /message siblings', () => {
      expect(() => assertNotReserved('GET', '/mcp/sse', reserved)).toThrow(ReservedRouteCollisionError);
      expect(() => assertNotReserved('POST', '/mcp/message', reserved)).toThrow(ReservedRouteCollisionError);
    });

    it('rejects /health and /metrics', () => {
      expect(() => assertNotReserved('GET', '/health', reserved)).toThrow(ReservedRouteCollisionError);
      expect(() => assertNotReserved('GET', '/metrics', reserved)).toThrow(ReservedRouteCollisionError);
    });

    it('rejects anything under /oauth and /.well-known (prefix match)', () => {
      expect(() => assertNotReserved('GET', '/oauth/authorize', reserved)).toThrow(ReservedRouteCollisionError);
      expect(() => assertNotReserved('GET', '/.well-known/oauth-protected-resource', reserved)).toThrow(
        ReservedRouteCollisionError,
      );
      // bare prefix itself
      expect(() => assertNotReserved('GET', '/oauth', reserved)).toThrow(ReservedRouteCollisionError);
    });

    it('does not treat a path that merely shares a prefix substring as reserved', () => {
      // '/healthcheck' is NOT '/health' and not under a reserved prefix
      expect(() => assertNotReserved('GET', '/healthcheck', reserved)).not.toThrow();
      // '/oauthx' is not '/oauth' nor under '/oauth/'
      expect(() => assertNotReserved('GET', '/oauthx', reserved)).not.toThrow();
    });

    it('normalizes a trailing slash before comparing', () => {
      expect(() => assertNotReserved('GET', '/health/', reserved)).toThrow(ReservedRouteCollisionError);
    });
  });

  describe('wrapWithAuth', () => {
    const logger = makeLogger();

    it('responds 401 with WWW-Authenticate when unauthorized', async () => {
      const inner = jest.fn();
      const verify: () => Promise<VerifyResult> = async () => ({
        kind: 'unauthorized',
        prmMetadataHeader: 'Bearer realm="x"',
      });
      const wrapped = wrapWithAuth(inner, verify, logger);
      const res = makeRes();

      await wrapped({ headers: {} } as ServerRequest, res, async () => {});

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Bearer realm="x"');
      expect(inner).not.toHaveBeenCalled();
    });

    it('responds 401 when verify resolves undefined', async () => {
      const inner = jest.fn();
      const wrapped = wrapWithAuth(inner, async () => undefined, logger);
      const res = makeRes();

      await wrapped({ headers: {} } as ServerRequest, res, async () => {});

      expect(res.statusCode).toBe(401);
      expect(inner).not.toHaveBeenCalled();
    });

    it('responds 403 with WWW-Authenticate when forbidden', async () => {
      const inner = jest.fn();
      const verify: () => Promise<VerifyResult> = async () => ({
        kind: 'forbidden',
        prmMetadataHeader: 'Bearer error="insufficient_scope"',
      });
      const wrapped = wrapWithAuth(inner, verify, logger);
      const res = makeRes();

      await wrapped({ headers: {} } as ServerRequest, res, async () => {});

      expect(res.statusCode).toBe(403);
      expect(res.headers['WWW-Authenticate']).toBe('Bearer error="insufficient_scope"');
      expect(inner).not.toHaveBeenCalled();
    });

    it('attaches authSession and calls the inner handler when authorized', async () => {
      const inner = jest.fn();
      const authorization = { token: 't', user: { sub: 'u1' } };
      const verify: () => Promise<VerifyResult> = async () => ({ kind: 'authorized', authorization });
      const wrapped = wrapWithAuth(inner, verify, logger);
      const req = { headers: {} } as ServerRequest;
      const res = makeRes();

      await wrapped(req, res, async () => {});

      expect(inner).toHaveBeenCalledTimes(1);
      expect(req.authSession).toBe(authorization);
    });
  });

  describe('wrapWithIpFilter (GHSA-hwfp-xv2f-fr8g)', () => {
    it('answers with the rejection and never runs the handler', async () => {
      const inner = jest.fn();
      const res = makeRes();
      const wrapped = wrapWithIpFilter(inner, async () => httpRespond.forbidden());

      await wrapped({} as ServerRequest, res, async () => {});

      expect({ status: res.statusCode, body: res.body, handled: inner.mock.calls.length }).toEqual({
        status: 403,
        body: { error: 'Forbidden' },
        handled: 0,
      });
    });

    it('runs the handler when the flow answers nothing', async () => {
      const inner = jest.fn();
      const req = {} as ServerRequest;
      const res = makeRes();

      const wrapped = wrapWithIpFilter(inner, async () => undefined);

      await wrapped(req, res, async () => {});

      expect(inner).toHaveBeenCalledWith(req, res, expect.any(Function));
    });
  });

  describe('registerCustomHttpRoutes', () => {
    const logger = makeLogger();
    const verifySession = jest.fn(async () => ({ kind: 'authorized', authorization: {} }) as VerifyResult);
    const checkClientIp: CheckClientIpFn = jest.fn(async () => undefined);

    function makeServer() {
      return {
        registerRoute: jest.fn(),
        registerMiddleware: jest.fn(),
        enhancedHandler: jest.fn((h: unknown) => h),
        prepare: jest.fn(),
        getHandler: jest.fn(),
        start: jest.fn(),
      };
    }

    it('is a no-op when routes is undefined or empty', () => {
      const server = makeServer();
      registerCustomHttpRoutes({
        routes: undefined,
        server: server as never,
        verifySession,
        checkClientIp,
        entryPath: '',
        routeBase: '',
        logger,
      });
      registerCustomHttpRoutes({
        routes: [],
        server: server as never,
        verifySession,
        checkClientIp,
        entryPath: '',
        routeBase: '',
        logger,
      });
      expect(server.registerRoute).not.toHaveBeenCalled();
    });

    it('registers a public route behind the ipFilter check only (no auth wrapper)', async () => {
      const server = makeServer();
      const handler = jest.fn();
      const routes: HttpRouteConfig[] = [{ method: 'GET', path: '/ping', handler }];

      registerCustomHttpRoutes({
        routes,
        server: server as never,
        verifySession,
        checkClientIp,
        entryPath: '',
        routeBase: '',
        logger,
      });

      const [method, path, registered] = server.registerRoute.mock.calls[0];
      await registered({} as ServerRequest, makeRes(), async () => {});
      expect({ method, path }).toEqual({ method: 'GET', path: '/ping' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(verifySession).not.toHaveBeenCalled();
    });

    it('checks the client IP before an auth:true route verifies the session (GHSA-hwfp-xv2f-fr8g)', async () => {
      const server = makeServer();
      const handler = jest.fn();
      const verify = jest.fn(async () => ({ kind: 'authorized', authorization: {} }) as VerifyResult);
      const rejectAll: CheckClientIpFn = async () => httpRespond.forbidden();

      registerCustomHttpRoutes({
        routes: [{ method: 'GET', path: '/secret', handler, auth: true }],
        server: server as never,
        verifySession: verify,
        checkClientIp: rejectAll,
        entryPath: '',
        routeBase: '',
        logger,
      });

      const res = makeRes();
      await server.registerRoute.mock.calls[0][2]({} as ServerRequest, res, async () => {});
      expect({
        status: res.statusCode,
        verified: verify.mock.calls.length,
        handled: handler.mock.calls.length,
      }).toEqual({
        status: 403,
        verified: 0,
        handled: 0,
      });
    });

    it('wraps an auth:true route (registered handler differs from the user handler)', () => {
      const server = makeServer();
      const handler = jest.fn();
      const routes: HttpRouteConfig[] = [{ method: 'GET', path: '/secret', handler, auth: true }];

      registerCustomHttpRoutes({
        routes,
        server: server as never,
        verifySession,
        checkClientIp,
        entryPath: '',
        routeBase: '',
        logger,
      });

      expect(server.registerRoute).toHaveBeenCalledTimes(1);
      const [method, path, registered] = server.registerRoute.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toBe('/secret');
      expect(registered).not.toBe(handler); // wrapped
    });

    it('throws ReservedRouteCollisionError before registering any route on a collision', () => {
      const server = makeServer();
      const routes: HttpRouteConfig[] = [
        { method: 'GET', path: '/ok', handler: jest.fn() },
        { method: 'POST', path: '/mcp', handler: jest.fn() }, // collides with entryPath
      ];

      expect(() =>
        registerCustomHttpRoutes({
          routes,
          server: server as never,
          verifySession,
          checkClientIp,
          entryPath: '/mcp',
          routeBase: '',
          logger,
        }),
      ).toThrow(ReservedRouteCollisionError);
    });
  });
});
