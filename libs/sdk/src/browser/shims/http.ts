/**
 * Browser shim for node:http
 *
 * Provides stub classes for type compatibility.
 * HTTP server functionality is not available in the browser.
 * Browser builds use in-memory transport only.
 */

export class IncomingMessage {}
export class ServerResponse {}
export class Server {}

export function createServer(): never {
  throw new Error('http.createServer() is not available in the browser.');
}

export default { IncomingMessage, ServerResponse, Server, createServer };
