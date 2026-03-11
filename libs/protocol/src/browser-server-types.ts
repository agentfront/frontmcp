/**
 * Browser stubs for Node.js http types.
 *
 * These provide the minimal class shape needed by ServerRequest/ServerResponse
 * in browser environments where the `http` module is unavailable.
 */

export class IncomingMessage {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined> = {};
}

export class HttpServerResponse {
  statusCode?: number;
  end(): void {
    /* no-op in browser */
  }
}
