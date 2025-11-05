// server/adapters/express.host.adapter.ts
import * as http from 'node:http';
import express from 'express';
import cors from 'cors';
import { HostServerAdapter } from './base.host.adapter';
import { HttpMethod, ServerRequest, ServerRequestHandler, ServerResponse } from '@frontmcp/sdk';

export class ExpressHostAdapter extends HostServerAdapter {
  private app = express();
  private router = express.Router();

  constructor() {
    super();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cors({ origin: '*', maxAge: 300 }));
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

  start(port: number) {
    this.app.use('/', this.router);
    const server = http.createServer(this.app);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 75_000;
    server.listen(port, () => console.log(`MCP HTTP (Express) on ${port}`));
  }

}
