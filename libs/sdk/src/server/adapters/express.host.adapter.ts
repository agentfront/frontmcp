// server/adapters/express.host.adapter.ts
import * as http from 'node:http';

import cors from 'cors';
import express from 'express';

import { fileExists, unlink } from '@frontmcp/utils';

import {
  type CorsOptions,
  type HttpMethod,
  type ServerRequest,
  type ServerRequestHandler,
  type ServerResponse,
} from '../../common';
import type { SecurityOptions } from '../../common/types/options/http/interfaces';
import { PayloadTooLargeError } from '../../errors/mcp.error';
import { createHostValidationMiddleware } from '../middleware/host-validation.middleware';
import { allowedHostsFromEnv, deriveAllowedHosts, shouldEnforceDerivedHosts } from '../security/resolve-allowed-hosts';
import { HostServerAdapter } from './base.host.adapter';

/**
 * Default request body size for the Express host. Lifts body-parser's silent
 * 100KB default, which routinely rejected base64-encoded PDFs, DOCXes, and
 * large HTML inputs before they reached MCP tool handlers (issue #410).
 */
export const DEFAULT_EXPRESS_BODY_LIMIT = '4mb';

/**
 * Options for ExpressHostAdapter.
 */
export interface ExpressHostAdapterOptions {
  /**
   * CORS configuration.
   * The middleware is installed only when `origin` is set to something other than `false`, so
   * omitting `cors` — or passing `{}` / `{ origin: false }` — sends no CORS headers at all.
   */
  cors?: CorsOptions;

  /**
   * Security options for transport hardening.
   * Includes bind address and DNS rebinding protection.
   */
  security?: SecurityOptions;

  /**
   * Maximum body size for `express.json()`. Accepts a number of bytes or a
   * body-parser-compatible string ('4mb', '500kb', etc.). Defaults to '4mb'.
   */
  bodyLimit?: number | string;

  /**
   * Maximum body size for `express.urlencoded()`. Falls back to `bodyLimit`
   * when omitted.
   */
  urlencodedLimit?: number | string;

  /**
   * Resolved listening address and port, plus the configured issuer. Used to
   * derive the default DNS-rebinding allow-list — the names a client can
   * legitimately use to reach this process.
   */
  listen?: {
    bindAddress?: string;
    port?: number;
    socketPath?: string;
    issuer?: string;
  };
}

export class ExpressHostAdapter extends HostServerAdapter {
  private app = express();
  private router = express.Router();
  private prepared = false;
  /** Active host-validation middleware, or undefined while nothing is enforced. */
  private hostValidation?: ReturnType<typeof createHostValidationMiddleware>;
  /** Builds the derived allow-list, once this process commits to listening. */
  private deriveHostValidation?: () => ReturnType<typeof createHostValidationMiddleware> | undefined;

  constructor(options?: ExpressHostAdapterOptions) {
    super();

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
      this.app.use(
        cors({
          origin: corsOptions.origin,
          credentials: corsOptions.credentials ?? false,
          maxAge: corsOptions.maxAge ?? 300,
        }),
      );
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
    // Tolerant Content-Type matching (#473). Some OAuth clients (e.g. the MCP
    // Inspector token refresh) send a hybrid header such as
    // `application/json, application/x-www-form-urlencoded`. body-parser's
    // default `type` matcher can't parse a comma-list, so NEITHER stock parser
    // fired and `req.body` arrived empty — surfacing as an opaque
    // "Invalid request body" at /oauth/token. We widen the matchers so:
    //   - a header that CONTAINS `x-www-form-urlencoded` parses as urlencoded
    //     (form wins; an actual form body would fail JSON.parse), and
    //   - a header that CONTAINS `application/json` (and NOT the form type)
    //     parses as JSON.
    // Clean single-type headers keep their existing behavior.
    const headerContains = (req: http.IncomingMessage, needle: string): boolean =>
      (req.headers['content-type'] ?? '').toLowerCase().includes(needle);
    const isUrlencoded = (req: http.IncomingMessage): boolean =>
      headerContains(req, 'application/x-www-form-urlencoded');
    const isJson = (req: http.IncomingMessage): boolean =>
      headerContains(req, 'application/json') && !isUrlencoded(req);
    this.app.use(express.urlencoded({ extended: true, limit: formLimit, type: isUrlencoded }));
    this.app.use(express.json({ limit: jsonLimit, type: isJson }));

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
   * the bound port, the bound NIC address, and the configured issuer host.
   *
   * Escape hatches, in precedence order: explicit
   * `security.dnsRebindingProtection.allowedHosts`, the
   * `FRONTMCP_ALLOWED_HOSTS` env var, or `enabled: false` to turn it off.
   */
  private installHostValidation(options?: ExpressHostAdapterOptions): void {
    const protection = options?.security?.dnsRebindingProtection;
    if (protection?.enabled === false) return;

    const allowedOrigins = protection?.allowedOrigins;
    const explicitHosts = protection?.allowedHosts ?? allowedHostsFromEnv();

    // An EXPLICIT allow-list applies to every deployment shape — this process
    // did not have to guess it.
    if (explicitHosts?.length || allowedOrigins?.length) {
      this.hostValidation = createHostValidationMiddleware({
        enabled: true,
        allowedHosts: explicitHosts?.length ? explicitHosts : undefined,
        allowedOrigins,
      });
    } else {
      // Otherwise the allow-list can only be DERIVED, and that is sound only
      // when this process owns the listener and therefore knows the address and
      // port clients reach it on. `start()` says so; a serverless handler
      // (`getHandler()`) never calls it, and its public hostname is unknowable
      // here — deriving one there would 403 every real request.
      this.deriveHostValidation = () => {
        const derivation = {
          bindAddress: options?.listen?.bindAddress,
          port: options?.listen?.port,
          socketPath: options?.listen?.socketPath,
          issuer: options?.listen?.issuer,
        };
        if (!shouldEnforceDerivedHosts(derivation)) {
          // A routable bind with no public name to add: enforcing the derived
          // list would 403 every request arriving under the deployment's real
          // hostname. Warn instead — a server reachable from the network is not
          // the DNS-rebinding target anyway (that attack exists to reach
          // addresses the attacker otherwise cannot).
          console.warn(
            '[frontmcp] DNS-rebinding protection is not enforcing a Host allow-list: the server binds a routable ' +
              `address (${derivation.bindAddress ?? 'unknown'}) and no allowed hosts are configured. ` +
              'Set security.dnsRebindingProtection.allowedHosts (or FRONTMCP_ALLOWED_HOSTS) to your public hostname(s).',
          );
          return undefined;
        }

        const allowedHosts = deriveAllowedHosts(derivation);
        // A Unix-socket server derives no hosts (the socket's permissions are
        // the boundary). With nothing to check against, validating would reject
        // everything, so skip it rather than fail closed on a valid config.
        if (!allowedHosts.length) return undefined;

        return createHostValidationMiddleware({ enabled: true, allowedHosts });
      };
    }

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
  private enableDerivedHostValidation(): void {
    if (this.hostValidation || !this.deriveHostValidation) return;
    this.hostValidation = this.deriveHostValidation();
    this.deriveHostValidation = undefined;
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

  async start(portOrSocketPath: number | string, bindAddress?: string) {
    // This process owns the listener, so the derived allow-list is meaningful.
    this.enableDerivedHostValidation();
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
      const host = bindAddress ?? '0.0.0.0';
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(portOrSocketPath, host, () => {
          console.log(`MCP HTTP (Express) on ${host}:${portOrSocketPath}`);
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
