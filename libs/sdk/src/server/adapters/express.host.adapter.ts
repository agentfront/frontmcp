// server/adapters/express.host.adapter.ts
import * as http from 'node:http';

import cors from 'cors';
import express from 'express';

import { type HttpMethod, type ServerRequest, type ServerRequestHandler, type ServerResponse } from '../../common';
import { PayloadTooLargeError } from '../../errors/mcp.error';
import { applyMachineIdHeader } from '../../ha/ha-headers';
import { resolveSecurityHeaders } from '../middleware/csp.middleware';
import { HostServerAdapter } from './base.host.adapter';
import {
  closeHttpServer,
  DEFAULT_EXPRESS_BODY_LIMIT,
  isJson,
  isUrlencoded,
  listenHttpServer,
  planHostValidation,
  SERVER_DRAIN_MS,
  type ExpressHostAdapterOptions,
  type HostValidation,
} from './host-adapter.shared';
import { keepBodyBytes, utf8JsonParser } from './utf8-json.parser';

export { DEFAULT_EXPRESS_BODY_LIMIT, type ExpressHostAdapterOptions } from './host-adapter.shared';

export class ExpressHostAdapter extends HostServerAdapter {
  private app = express();
  private router = express.Router();
  private prepared = false;
  private httpServer?: http.Server;
  /** Active host-validation middleware, or undefined while nothing is enforced. */
  private hostValidation?: HostValidation;
  /** Builds the derived allow-list, once this process commits to listening. */
  private deriveHostValidation?: (
    portOrSocketPath: number | string,
    bindAddress?: string,
  ) => HostValidation | undefined;

  constructor(options?: ExpressHostAdapterOptions) {
    super();

    // Never advertise the framework, and send the security headers on every
    // response — including 4xx/5xx from the middleware below (host validation,
    // 413) — so they are installed first. A distributed instance names itself
    // on every response the same way (`X-FrontMCP-Machine-Id`, #665): health
    // probes, metrics, 404s and every MCP protocol revision included.
    this.app.disable('x-powered-by');
    const securityHeaders = resolveSecurityHeaders(options?.securityHeaders);
    this.app.use((_req, res, next) => {
      for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
      applyMachineIdHeader(res);
      next();
    });

    // CORS must run BEFORE the body parsers so the 413-on-too-large response
    // still carries `Access-Control-Allow-Origin` and friends. If CORS runs
    // after the parsers, body-parser's `entity.too.large` short-circuits to
    // our error handler before CORS ever sees the request — and browsers
    // refuse to surface the structured 413 body to JS (CodeRabbit on PR #422).
    // CORS middleware is only enabled when an explicit origin is provided —
    // prevents accidental enabling with `{ credentials: true }` alone.
    const corsOptions = options?.cors;
    const corsEnabled = corsOptions?.origin !== undefined && corsOptions.origin !== false;
    if (corsEnabled) {
      const configuredCors = cors({
        origin: corsOptions.origin,
        credentials: corsOptions.credentials ?? false,
        maxAge: corsOptions.maxAge ?? 300,
      });
      const publicCorsPaths = new Set(options?.publicCorsPaths);
      this.app.use((req, res, next) => (publicCorsPaths.has(req.path) ? next() : configuredCors(req, res, next)));
    }

    // Host validation (DNS-rebinding protection, GHSA-mc9g-v2cp-vfff).
    //
    // Installed BEFORE the body parsers: a request whose Host this server does
    // not answer to is refused without buffering its body. It is also installed
    // before routing, so the MCP endpoint, the OAuth routes, the SSE transport
    // and any custom route are covered uniformly.
    this.installHostValidation(options);

    const jsonLimit = options?.bodyLimit ?? DEFAULT_EXPRESS_BODY_LIMIT;
    const formLimit = options?.urlencodedLimit ?? jsonLimit;
    this.app.use(express.urlencoded({ extended: true, limit: formLimit, type: isUrlencoded, verify: keepBodyBytes }));
    this.app.use(utf8JsonParser(jsonLimit));
    this.app.use(express.json({ limit: jsonLimit, type: isJson, verify: keepBodyBytes }));

    // Translate body-parser's `entity.too.large` (raised when a request body
    // exceeds the configured `limit`) into a structured JSON-RPC 413 response
    // so MCP clients receive a parseable error envelope instead of Express's
    // default HTML error page. The envelope shape is owned by `PayloadTooLargeError`
    // so protocol error shape stays centralized in the SDK error layer.
    this.app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
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
    });

    // When creating the HTTP(S) server that hosts /mcp:
    this.app.use((req, res, next) => {
      // Only set CORS-specific headers when CORS is enabled
      if (corsEnabled) {
        res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
      }
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      next();
    });
  }

  /**
   * Install DNS-rebinding protection.
   *
   * ON by default since v1.7.2 (BC-035). `allowedHosts` falls back to the names
   * this process actually answers to — the loopback aliases with and without
   * the bound port, the bound NIC address, and the configured issuer host —
   * whether or not `allowedOrigins` is set. On a loopback bind `allowedOrigins`
   * falls back to its own origins and the CORS list.
   *
   * Escape hatches, in precedence order: explicit
   * `security.dnsRebindingProtection.allowedHosts`, the
   * `FRONTMCP_ALLOWED_HOSTS` env var, or `enabled: false` to turn it off.
   */
  private installHostValidation(options?: ExpressHostAdapterOptions): void {
    const plan = planHostValidation(options);
    if (!plan) return;
    this.hostValidation = plan.initial;
    this.deriveHostValidation = plan.derive;

    // Installed unconditionally so it keeps its place ahead of the body parsers;
    // it is inert until a rule set exists.
    this.app.use(((req, res, next) => {
      const validate = this.hostValidation;
      if (!validate) return next();
      return validate(req as never, res as never, next);
    }) as express.RequestHandler);
  }

  /**
   * Enable the DERIVED host allow-list. Called from `start()` only — see
   * `installHostValidation`.
   */
  private enableDerivedHostValidation(portOrSocketPath: number | string, bindAddress?: string): void {
    if (!this.deriveHostValidation) return;
    this.hostValidation = this.deriveHostValidation(portOrSocketPath, bindAddress) ?? this.hostValidation;
    this.deriveHostValidation = undefined;
  }

  /**
   * @internal Enforce the allow-list the node:http host derived for its listener, which serves the requests it
   * hands to this app (`NodeHttpHostAdapter`), instead of deriving (and warning) a second time.
   */
  adoptHostValidation(validate: HostValidation | undefined): void {
    this.hostValidation = validate;
    this.deriveHostValidation = undefined;
  }

  registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler) {
    this.router[method.toLowerCase()](path, this.enhancedHandler(handler));
  }

  registerMiddleware(entryPath: string, handler: ServerRequestHandler) {
    this.router.use(entryPath, handler as any);
  }

  private enhancedHandler(handler: ServerRequestHandler) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      // TODO: add request/response enhancements here if needed
      const request = req as ServerRequest;
      const response = res as ServerResponse;
      return handler(request, response, next);
    };
  }

  /**
   * Prepares the Express app with routes but does NOT start the HTTP server.
   * Used for serverless deployments (Vercel, AWS Lambda, etc.)
   * This method is idempotent - safe to call multiple times.
   */
  prepare(): void {
    if (this.prepared) return;
    this.prepared = true;
    this.app.use('/', this.router);
  }

  /**
   * Returns the Express app for serverless exports.
   * Automatically calls prepare() to ensure routes are registered.
   */
  getHandler(): express.Application {
    this.prepare();
    return this.app;
  }

  async start(portOrSocketPath: number | string, bindAddress?: string) {
    this.prepare();
    const server = http.createServer(this.app);
    this.httpServer = server;
    await listenHttpServer(
      server,
      portOrSocketPath,
      bindAddress,
      'Express',
      (boundPortOrSocketPath, boundAddress) => this.enableDerivedHostValidation(boundPortOrSocketPath, boundAddress),
      () => this.stop(0),
    );
  }

  /**
   * Stop accepting connections, close idle keep-alive connections, and give requests in
   * flight `drainMs` to finish before closing what is left (SSE streams never finish) (#712).
   */
  override async stop(drainMs = SERVER_DRAIN_MS): Promise<void> {
    const server = this.httpServer;
    if (!server) return;
    this.httpServer = undefined;
    await closeHttpServer(server, drainMs);
  }
}
