// server/adapters/node-http.host.adapter.ts
//
// The HTTP host of a server whose routes are all FrontMCP's own (#948): an Express app's request pipeline on
// node:http, without loading Express. A server that adds a route or middleware of its own, a request only Express
// parses the same way (a form body, a JSON body in another charset or compressed, a query string under Express 4),
// and the serverless handler all get the Express app as before, built the first time one needs it.
import * as http from 'node:http';
import * as querystring from 'node:querystring';

import { type HttpMethod, type ServerRequestHandler } from '../../common';
import { PayloadTooLargeError } from '../../errors/mcp.error';
import { applyMachineIdHeader } from '../../ha/ha-headers';
import { resolveSecurityHeaders } from '../middleware/csp.middleware';
import { isSdkHttpHandler } from '../sdk-http-handler';
import { HostServerAdapter } from './base.host.adapter';
import type { ExpressHostAdapter } from './express.host.adapter';
import {
  closeHttpServer,
  DEFAULT_EXPRESS_BODY_LIMIT,
  isJson,
  isUrlencoded,
  isUtf8Json,
  listenHttpServer,
  planHostValidation,
  SERVER_DRAIN_MS,
  type ExpressHostAdapterOptions,
  type HostValidation,
} from './host-adapter.shared';
import {
  bodyParserLimit,
  finalHandler,
  isRequestFinished,
  json,
  onRequestFinished,
  redirect,
  send,
  sendOptions,
  status,
  type ExpressFlavor,
} from './node-http/express-compat';
import { parseRequestUrl } from './node-http/request-url';
import {
  isSupportedPath,
  Router,
  type ErrorHandler,
  type NativeRequest,
  type NativeResponse,
  type NextFunction,
  type RequestHandler,
} from './node-http/router';
import { utf8JsonParserWith, type BodyReader } from './utf8-json.body';

export type { ExpressFlavor } from './node-http/express-compat';

type Registration =
  | { kind: 'route'; method: HttpMethod; path: string; handler: ServerRequestHandler }
  | { kind: 'middleware'; path: string; handler: ServerRequestHandler };

/** Whether this host answers a registration itself: FrontMCP's own handler, on a path its router matches as Express does. */
function servesNatively(registration: Registration): boolean {
  return isSdkHttpHandler(registration.handler) && isSupportedPath(registration.path);
}

/** type-is's `hasBody`: a request with a Transfer-Encoding or a numeric Content-Length. */
function hasBody(req: http.IncomingMessage): boolean {
  return req.headers['transfer-encoding'] !== undefined || !isNaN(req.headers['content-length'] as unknown as number);
}

type RawBody = (
  stream: http.IncomingMessage,
  options: { limit: number | null; length: string | undefined; encoding: null },
  callback: (error: (Error & { status?: number; statusCode?: number; expose?: boolean }) | null, body: Buffer) => void,
) => void;

/** http-errors' `createError(400, error)` on a read error: its own status (else 400), and `expose` below 500. */
function asReadError(error: Error & { status?: number; statusCode?: number; expose?: boolean }): Error {
  let code: unknown = error.status || error.statusCode || 400;
  if (typeof code !== 'number' || (!http.STATUS_CODES[code] && (code < 400 || code >= 600))) code = 500;
  const statusCode = code as number;
  if (error.status !== statusCode || error.statusCode !== statusCode) {
    error.expose = statusCode < 500;
    error.status = error.statusCode = statusCode;
  }
  return error;
}

/**
 * body-parser 2's `raw()` read, for the bodies this host parses: UTF-8 JSON without a content encoding (the others
 * go to Express). The body is read by raw-body, with body-parser's limit, errors and draining.
 */
function readUtf8JsonBody(limit: number | string): BodyReader {
  const byteLimit = bodyParserLimit(limit);
  return (req, _res, next) => {
    const request = req as NativeRequest & { length?: unknown };
    if (isRequestFinished(req)) {
      next();
      return;
    }
    if (!('body' in request)) request.body = undefined;
    if (!hasBody(req) || !isUtf8Json(req)) {
      next();
      return;
    }
    const length = req.headers['content-length'];
    // body-parser's contentstream() sets the length on the request, and read() clears it again
    request.length = length;
    request.length = undefined;
    // A peer dependency of the SDK, loaded on the first body
    const getBody = require('raw-body') as RawBody;
    getBody(req, { limit: byteLimit, length, encoding: null }, (error, body) => {
      if (error) {
        const readError = asReadError(error);
        if (isRequestFinished(req)) {
          next(readError);
        } else {
          onRequestFinished(req, () => next(readError));
          req.resume();
        }
        return;
      }
      request.body = body;
      next();
    });
  };
}

/** body-parser 2's `read()` for a request one of its parsers does not parse: `req.body` exists from then on. */
const markBodyUnparsed: RequestHandler = (req, _res, next) => {
  if (!isRequestFinished(req) && !('body' in req)) req.body = undefined;
  next();
};

/**
 * The node:http host. Construct it as `ExpressHostAdapter`; the installed Express decides what an Express app
 * would do (`flavor`).
 */
export class NodeHttpHostAdapter extends HostServerAdapter {
  private readonly registrations: Registration[] = [];
  private readonly app: Router;
  private readonly router: Router;
  private readonly requestClass: typeof http.IncomingMessage;
  private readonly responseClass: typeof http.ServerResponse;
  /** The app's environment, as Express reads it when the app is created. */
  private readonly env = process.env['NODE_ENV'] || 'development';
  private prepared = false;
  private serveAll = true;
  private express?: ExpressHostAdapter;
  private httpServer?: http.Server;
  private listening = false;
  /** Active host-validation middleware, or undefined while nothing is enforced. */
  private hostValidation?: HostValidation;
  /** Builds the derived allow-list, once this process commits to listening. */
  private deriveHostValidation?: (
    portOrSocketPath: number | string,
    bindAddress?: string,
  ) => HostValidation | undefined;

  constructor(
    private readonly options: ExpressHostAdapterOptions | undefined,
    private readonly flavor: ExpressFlavor,
  ) {
    super();
    const hooks = {
      catchRejections: flavor.major >= 5,
      dotEndsMountPath: flavor.major < 5,
      sendOptions: (res: NativeResponse, methods: string[]) => sendOptions(res.req, res, methods, flavor),
    };
    this.app = new Router(hooks);
    this.router = new Router(hooks);
    ({ requestClass: this.requestClass, responseClass: this.responseClass } = this.messageClasses());

    if (flavor.major < 5) {
      // Express 4's query middleware: an empty query string parses to {} (a non-empty one goes to Express)
      this.app.use('/', (req, _res, next) => {
        if (!req.query) req.query = {};
        next();
      });
    }
    // expressInit: link the request and response, and give the response its locals
    this.app.use('/', (req, res, next) => {
      req.res = res;
      res.req = req;
      req.next = next;
      res.locals = res.locals || Object.create(null);
      next();
    });

    // What ExpressHostAdapter installs, in the same order and with the same options (see its constructor)
    const securityHeaders = resolveSecurityHeaders(options?.securityHeaders);
    this.app.use('/', (_req, res, next) => {
      for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
      applyMachineIdHeader(res);
      next();
    });

    const corsOptions = options?.cors;
    const corsEnabled = corsOptions?.origin !== undefined && corsOptions.origin !== false;
    if (corsEnabled) {
      // A peer dependency of the SDK, loaded only with CORS on
      const cors = require('cors') as typeof import('cors');
      const configuredCors = cors({
        origin: corsOptions.origin,
        credentials: corsOptions.credentials ?? false,
        maxAge: corsOptions.maxAge ?? 300,
      }) as unknown as RequestHandler;
      const publicCorsPaths = new Set(options?.publicCorsPaths);
      this.app.use('/', (req, res, next) => (publicCorsPaths.has(req.path) ? next() : configuredCors(req, res, next)));
    }

    const plan = planHostValidation(options);
    if (plan) {
      this.hostValidation = plan.initial;
      this.deriveHostValidation = plan.derive;
      this.app.use('/', (req, res, next) => {
        const validate = this.hostValidation;
        if (!validate) return next();
        return validate(req as never, res as never, next);
      });
    }

    const jsonLimit = options?.bodyLimit ?? DEFAULT_EXPRESS_BODY_LIMIT;
    this.app.use('/', markBodyUnparsed);
    this.app.use('/', utf8JsonParserWith(readUtf8JsonBody(jsonLimit)) as unknown as RequestHandler);
    this.app.use('/', markBodyUnparsed);

    const payloadTooLarge: ErrorHandler = (err, _req, res, next) => {
      const e = err as { type?: string; limit?: number; length?: number } | undefined;
      if (e?.type === 'entity.too.large') {
        const payloadError = new PayloadTooLargeError(e.limit, e.length);
        res.status(payloadError.statusCode).json({
          jsonrpc: '2.0',
          id: null,
          error: payloadError.toJsonRpcError(),
        });
        return;
      }
      next(err);
    };
    this.app.use('/', payloadTooLarge);

    this.app.use('/', (_req, res, next) => {
      if (corsEnabled) {
        res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
      }
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      next();
    });
  }

  /** The request and response classes of the server: an Express request's `path` (and Express 5's `query`), and `res.status/send/json/redirect`. */
  private messageClasses(): { requestClass: typeof http.IncomingMessage; responseClass: typeof http.ServerResponse } {
    const flavor = this.flavor;
    class NodeHttpRequest extends http.IncomingMessage {
      get path(): string {
        return parseRequestUrl(this)?.pathname as string;
      }
    }
    if (flavor.major >= 5) {
      Object.defineProperty(NodeHttpRequest.prototype, 'query', {
        configurable: true,
        enumerable: true,
        get(this: NativeRequest) {
          return querystring.parse(parseRequestUrl(this)?.query ?? '');
        },
      });
    }
    class NodeHttpResponse extends http.ServerResponse<NodeHttpRequest> {
      status(code: number): this {
        status(this, code, flavor);
        return this;
      }
      send(body?: unknown): this {
        send(this.req as unknown as NativeRequest, this as unknown as NativeResponse, body, flavor);
        return this;
      }
      json(body?: unknown): this {
        json(this.req as unknown as NativeRequest, this as unknown as NativeResponse, body, flavor);
        return this;
      }
      redirect(statusOrUrl: number | string, url?: string): void {
        const args = (url === undefined ? [statusOrUrl] : [statusOrUrl, url]) as [number | string, string?];
        redirect(this.req as unknown as NativeRequest, this as unknown as NativeResponse, args);
      }
    }
    return { requestClass: NodeHttpRequest, responseClass: NodeHttpResponse as typeof http.ServerResponse };
  }

  registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler) {
    this.record({ kind: 'route', method, path, handler });
  }

  registerMiddleware(entryPath: string, handler: ServerRequestHandler) {
    this.record({ kind: 'middleware', path: entryPath, handler });
  }

  private record(registration: Registration): void {
    this.registrations.push(registration);
    if (this.serveAll && !servesNatively(registration)) this.serveAll = false;
    if (this.serveAll) {
      const handler = registration.handler as unknown as RequestHandler;
      // The Express host wraps a route's handler in a three-argument one (enhancedHandler), and mounts middleware as is
      if (registration.kind === 'route') {
        this.router.route(registration.method, registration.path, (req, res, next) => handler(req, res, next));
      } else {
        this.router.use(registration.path, handler);
      }
    }
    if (this.express) replay(this.express, registration);
  }

  /** The Express host serving what this one does not, built on first use with every registration so far. */
  private expressHost(): ExpressHostAdapter {
    if (!this.express) {
      const { ExpressHostAdapter } = require('#express-host') as typeof import('#express-host');
      const host = new ExpressHostAdapter(this.options);
      for (const registration of this.registrations) replay(host, registration);
      if (this.listening) host.adoptHostValidation(this.hostValidation);
      if (this.prepared) host.prepare();
      this.express = host;
    }
    return this.express;
  }

  prepare(): void {
    if (this.prepared) return;
    this.prepared = true;
    this.app.use('/', this.router.asHandler);
    this.express?.prepare();
  }

  /** The Express app, for serverless exports: a serverless platform hands it its own request objects. */
  getHandler(): unknown {
    this.prepare();
    return this.expressHost().getHandler();
  }

  /** Whether a request goes to the Express app: a route of the server's own, or a body or query Express parses. */
  private needsExpress(req: http.IncomingMessage): boolean {
    if (!this.serveAll) return true;
    if (this.flavor.major < 5) {
      const query = parseRequestUrl(req)?.query;
      if (typeof query === 'string' && query.length > 0) return true;
    }
    if (!hasBody(req)) return false;
    if (isUrlencoded(req)) return true;
    if (!isJson(req)) return false;
    if (!isUtf8Json(req)) return true;
    return (req.headers['content-encoding'] || 'identity').toLowerCase() !== 'identity';
  }

  private readonly handleRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (this.needsExpress(req)) {
      (this.expressHost().getHandler() as http.RequestListener)(req, res);
      return;
    }
    const request = req as NativeRequest;
    const response = res as NativeResponse;
    this.app.handle(request, response, finalHandler(request, response, this.env));
  };

  async start(portOrSocketPath: number | string, bindAddress?: string) {
    this.prepare();
    // A server with routes of its own gets its Express app now, as it did before this host existed
    if (!this.serveAll) this.expressHost();
    const server = http.createServer(
      { IncomingMessage: this.requestClass, ServerResponse: this.responseClass },
      this.handleRequest,
    );
    this.httpServer = server;
    await listenHttpServer(
      server,
      portOrSocketPath,
      bindAddress,
      // The same line as the Express host's, which deployments read to know the server is up
      'Express',
      (boundPortOrSocketPath, boundAddress) => {
        if (this.deriveHostValidation) {
          this.hostValidation = this.deriveHostValidation(boundPortOrSocketPath, boundAddress) ?? this.hostValidation;
          this.deriveHostValidation = undefined;
        }
        this.listening = true;
        this.express?.adoptHostValidation(this.hostValidation);
      },
      () => this.stop(0),
    );
  }

  override async stop(drainMs = SERVER_DRAIN_MS): Promise<void> {
    const server = this.httpServer;
    if (!server) return;
    this.httpServer = undefined;
    await closeHttpServer(server, drainMs);
  }
}

function replay(host: ExpressHostAdapter, registration: Registration): void {
  if (registration.kind === 'route') host.registerRoute(registration.method, registration.path, registration.handler);
  else host.registerMiddleware(registration.path, registration.handler);
}

export type { NextFunction };
