// server/adapters/express.host.adapter.ts
import * as http from 'node:http';
import express from 'express';
import cors from 'cors';
import { HostServerAdapter } from './base.host.adapter';
import { HttpMethod, ServerRequest, ServerRequestHandler, ServerResponse } from '../../common';

/**
 * CORS configuration options for ExpressHostAdapter.
 */
export interface ExpressCorsOptions {
  /**
   * Allowed origins. Can be:
   * - `true` to reflect the request origin (allows all origins with credentials)
   * - `false` to disable CORS
   * - `'*'` to allow all origins (no credentials)
   * - A string for a single origin
   * - An array of strings for multiple origins
   * - A function that dynamically determines if an origin is allowed
   * @default false (CORS disabled by default for security)
   */
  origin?:
    | boolean
    | string
    | string[]
    | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);

  /**
   * Whether to allow credentials (cookies, authorization headers).
   * Cannot be used with `origin: '*'`.
   * @default false
   */
  credentials?: boolean;

  /**
   * How long preflight results can be cached (in seconds).
   * @default 300
   */
  maxAge?: number;
}

/**
 * Options for ExpressHostAdapter.
 */
export interface ExpressHostAdapterOptions {
  /**
   * CORS configuration.
   * For security, CORS is disabled by default.
   * Enable it explicitly with appropriate origins.
   */
  cors?: ExpressCorsOptions;
}

export class ExpressHostAdapter extends HostServerAdapter {
  private app = express();
  private router = express.Router();
  private prepared = false;

  constructor(options?: ExpressHostAdapterOptions) {
    super();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Configure CORS with secure defaults
    // CORS middleware is only enabled when an explicit origin is provided
    // This prevents accidental enabling with { credentials: true } alone
    const corsOptions = options?.cors;
    if (corsOptions?.origin !== undefined && corsOptions.origin !== false) {
      this.app.use(
        cors({
          origin: corsOptions.origin,
          credentials: corsOptions.credentials ?? false,
          maxAge: corsOptions.maxAge ?? 300,
        }),
      );
    }

    // When creating the HTTP(S) server that hosts /mcp:
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      next();
    });
  }

  registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler) {
    this.router[method.toLowerCase()](path, this.enhancedHandler(handler));
  }

  registerMiddleware(entryPath: string, handler: ServerRequestHandler) {
    this.router.use(entryPath, handler as any);
  }

  enhancedHandler(handler: ServerRequestHandler) {
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

  start(port: number) {
    this.prepare();
    const server = http.createServer(this.app);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 75_000;
    server.listen(port, () => console.log(`MCP HTTP (Express) on ${port}`));
  }
}
