import { IncomingMessage, ServerResponse as HttpServerResponse } from 'http';
import { Authorization } from '../types'; // TODO: move to internal

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export class ServerRequest extends IncomingMessage {
  declare method: HttpMethod;
  path: string;
  declare url: string;
  declare headers: Record<string, string>;
  query: Record<string, string | string[]>;
  body?: any;
  authSession?: Authorization;
}

export abstract class ServerResponse extends HttpServerResponse {
  abstract status(code: number): ServerResponse;

  abstract json(payload: any): void;

  abstract send(payload: any): void;

  abstract redirect(url: string): void;

  abstract redirect(status: number, url: string): void;
}

export type NextFn = () => Promise<void> | void;

export type ServerRequestHandler = (req: ServerRequest, res: ServerResponse, next: NextFn) => Promise<void> | void;

export abstract class FrontMcpServer {
  /**
   * Register a middleware handler for a specific entry path.
   * @param entryPath - e.g. '' or '/mcp'
   * @param handler - (req, res, next) => {// middleware // next()}
   */
  abstract registerMiddleware(entryPath: string, handler: ServerRequestHandler): Promise<void> | void;

  /**
   * Register a route handler for a specific path.
   * @param method - e.g. 'GET' or 'POST'
   * @param path - e.g. '/mcp/invoke'
   * @param handler - (req, res) => {// route handler // res.end() }
   */
  abstract registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler): Promise<void> | void;

  /**
   * Enhance a request handler with request/response processing and error handling.
   * This handle will be stored as the first middleware in the chain to align adapter handler
   * with the gateway's request/response processing.
   */
  abstract enhancedHandler(
    handler: ServerRequestHandler,
  ): (req: any, res: any, next: () => any) => Promise<void> | void;

  /**
   * Prepares the server routes without starting the HTTP listener.
   * Used for serverless deployments (Vercel, AWS Lambda, etc.)
   */
  abstract prepare(): void;

  /**
   * Returns the underlying HTTP handler for serverless exports.
   */
  abstract getHandler(): unknown;

  /**
   * Start the server on the specified port or Unix socket path.
   * When a string is provided, the server listens on a Unix socket.
   * When a number is provided, the server listens on a TCP port.
   */
  abstract start(portOrSocketPath?: number | string): Promise<void> | void;
}
