// server/adapters/express.host.adapter.ts
import * as http from 'node:http';
import express from 'express';
import cors from 'cors';
import { HostServerAdapter } from './base.host.adapter';
import { CorsOptions, HttpMethod, ServerRequest, ServerRequestHandler, ServerResponse } from '../../common';
import { fileExists, unlink } from '@frontmcp/utils';

/**
 * Options for ExpressHostAdapter.
 */
export interface ExpressHostAdapterOptions {
  /**
   * CORS configuration.
   * At the adapter level, CORS is disabled by default (no middleware installed).
   * Note: FrontMcpServerInstance provides a permissive default when `cors` is omitted.
   */
  cors?: CorsOptions;
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
    const corsEnabled = corsOptions?.origin !== undefined && corsOptions.origin !== false;
    if (corsEnabled) {
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
      // Only set CORS-specific headers when CORS is enabled
      if (corsEnabled) {
        res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
      }
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

  async start(portOrSocketPath: number | string) {
    this.prepare();
    const server = http.createServer(this.app);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 75_000;

    if (typeof portOrSocketPath === 'string') {
      // Unix socket mode - clean up stale socket file before listening
      await this.cleanupStaleSocket(portOrSocketPath);
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(portOrSocketPath, () => {
          // Set socket file permissions (owner + group read/write)
          // Using node:fs chmodSync directly - no chmod equivalent in @frontmcp/utils
          try {
            const fs = require('node:fs');
            fs.chmodSync(portOrSocketPath, 0o660);
          } catch {
            // chmod may fail on some platforms, non-critical
          }
          console.log(`MCP HTTP (Express) on unix://${portOrSocketPath}`);
          resolve();
        });
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(portOrSocketPath, () => {
          console.log(`MCP HTTP (Express) on ${portOrSocketPath}`);
          resolve();
        });
      });
    }
  }

  private async cleanupStaleSocket(socketPath: string): Promise<void> {
    try {
      if (await fileExists(socketPath)) {
        await unlink(socketPath);
      }
    } catch {
      // Ignore cleanup errors - listen will fail if socket is still in use
    }
  }
}
