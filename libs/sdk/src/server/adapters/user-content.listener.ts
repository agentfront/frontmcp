// server/adapters/user-content.listener.ts
import * as http from 'node:http';
import * as path from 'node:path';

import express from 'express';

import { stat } from '@frontmcp/utils';

import type { UserContentOptions } from '../../common/types/options/http/interfaces';
import { UserContentConfigurationError } from '../../errors/transport.errors';
import { buildCspHeaderValue, getCspHeaderName } from '../middleware/csp.middleware';
import { createHostValidationMiddleware } from '../middleware/host-validation.middleware';
import { deriveAllowedHosts, shouldEnforceDerivedHosts } from '../security/resolve-allowed-hosts';
import {
  assertSafeSocketDirectory,
  clearStaleSocket,
  enforceOwnerOnly,
  hasSocketFileMode,
  listenOwnerOnly,
} from '../security/unix-socket-guard';

const SERVER_DRAIN_MS = 5_000;

type HostValidation = ReturnType<typeof createHostValidationMiddleware>;

/** The `http.userContent` listener: static files under `root`, and a 404 for everything else, MCP and API routes included. */
export class UserContentListener {
  private httpServer?: http.Server;
  private hostValidation?: HostValidation;

  constructor(private readonly options: UserContentOptions) {
    if (options.allowedHosts?.length) {
      this.hostValidation = createHostValidationMiddleware({ enabled: true, allowedHosts: options.allowedHosts });
    }
  }

  /** Listen beside the MCP listener (`mainListener`: its port or socket path), on the same bind address. */
  async start(mainListener: number | string, bindAddress = '127.0.0.1'): Promise<void> {
    const { socketPath } = this.options;
    const port = this.options.port ?? 0;
    if (socketPath ? socketPath === mainListener : port !== 0 && port === mainListener) {
      throw new UserContentConfigurationError(
        `it needs a port or socketPath of its own, not the MCP listener's (${mainListener})`,
      );
    }
    const root = path.resolve(this.options.root);
    const isDirectory = await stat(root).then(
      (stats) => stats.isDirectory(),
      () => false,
    );
    if (!isDirectory) throw new UserContentConfigurationError(`root ${root} is not a directory`);

    const server = http.createServer(this.createApp(root, this.responseHeaders()));
    this.httpServer = server;
    server.keepAliveTimeout = 75_000;

    if (socketPath) {
      const ownerOnly = hasSocketFileMode();
      if (ownerOnly) {
        await assertSafeSocketDirectory(socketPath);
        await clearStaleSocket(socketPath);
      }
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        if (ownerOnly) listenOwnerOnly(server, socketPath, resolve);
        else server.listen(socketPath, resolve);
      });
      if (ownerOnly) {
        try {
          await enforceOwnerOnly(socketPath);
        } catch (error) {
          await this.stop(0);
          throw error;
        }
      }
      console.log(`User content on unix://${socketPath} (files from ${root})`);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, bindAddress, () => {
        const bound = server.address();
        const boundPort = typeof bound === 'object' && bound ? bound.port : port;
        const boundAddress = typeof bound === 'object' && bound ? bound.address : bindAddress;
        this.hostValidation ??= this.derivedHostValidation(boundAddress, boundPort);
        console.log(`User content on ${bindAddress}:${boundPort} (files from ${root})`);
        resolve();
      });
    });
  }

  /** The address the listener is bound to, once started. */
  address(): ReturnType<http.Server['address']> | undefined {
    return this.httpServer?.address();
  }

  /** Stop accepting connections and give requests in flight `drainMs` to finish, as the MCP listener does. */
  async stop(drainMs = SERVER_DRAIN_MS): Promise<void> {
    const server = this.httpServer;
    if (!server) return;
    this.httpServer = undefined;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    const forceClose = setTimeout(() => server.closeAllConnections(), drainMs);
    try {
      await closed;
    } finally {
      clearTimeout(forceClose);
    }
  }

  private createApp(root: string, headers: Record<string, string>): express.Application {
    const app = express();
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      next();
    });
    app.use(((req, res, next) => {
      const validate = this.hostValidation;
      if (!validate) return next();
      return validate(req as never, res as never, next);
    }) as express.RequestHandler);
    // `send` refuses `..` and dotfiles, never lists a directory, and sets Content-Type from the file's extension.
    app.use(express.static(root, { dotfiles: 'ignore', fallthrough: true }));
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).type('text/plain').send('Not Found');
    });
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).type('text/plain').send('Internal Server Error');
    });
    return app;
  }

  /** A routable bind cannot know the names it is reached by, so without `allowedHosts` it warns instead. */
  private derivedHostValidation(bindAddress: string, port: number): HostValidation | undefined {
    const derivation = { bindAddress, port };
    if (!shouldEnforceDerivedHosts(derivation)) {
      console.warn(
        `[frontmcp] http.userContent is not checking the Host header: it binds a routable address (${bindAddress}) ` +
          'and no allowed hosts are configured. Set http.userContent.allowedHosts to the content origin hostname(s).',
      );
      return undefined;
    }
    return createHostValidationMiddleware({ enabled: true, allowedHosts: deriveAllowedHosts(derivation) });
  }

  private responseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff', ...this.options.headers };
    const csp = this.options.csp;
    if (csp) {
      const directives = Object.fromEntries(
        Object.entries(csp.directives).map(([name, value]) => [name, Array.isArray(value) ? value.join(' ') : value]),
      );
      const reportOnly = csp.reportOnly ?? false;
      const value = buildCspHeaderValue({ enabled: true, directives, reportUri: csp.reportUri, reportOnly });
      if (value) headers[getCspHeaderName(reportOnly)] = value;
    }
    for (const [name, value] of Object.entries(headers)) {
      try {
        http.validateHeaderName(name);
        http.validateHeaderValue(name, value);
      } catch (error) {
        throw new UserContentConfigurationError(`header "${name}" cannot be sent: ${(error as Error).message}`);
      }
    }
    return headers;
  }
}
