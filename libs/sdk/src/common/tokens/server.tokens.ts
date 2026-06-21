import { type Authorization, type RawMetadataShape } from '../types';
import { type HttpRequestIntent } from '../utils';
import { tokenFactory } from './base.tokens';

interface ServerRequestTokenValue {
  intent: HttpRequestIntent;
  auth: Authorization;
  sessionId: string;
  /** Set when a terminated session is being re-initialized (unmarked from terminated set). */
  reinitialize: boolean;
  /**
   * The native Web `Request` carried alongside the normalized `ServerRequest`
   * when the `http:request` flow runs on a V8-isolate (Cloudflare Worker) via
   * the web-fetch adapter. Present ONLY in web mode — its presence is also the
   * signal the `handleWebFetch` execute stage filters on. The flow's MCP
   * execute stage hands it to `WebStandardStreamableHTTPServerTransport`, which
   * consumes the request body itself (so it must be a fresh, unread Request).
   */
  webRequest: Request | undefined;
  /**
   * The Worker `ExecutionContext` (`{ waitUntil }`) for the current fetch, used
   * to keep the isolate alive past `fetch` while an SSE response body streams.
   * Web mode only.
   */
  webCtx: { waitUntil?(promise: Promise<unknown>): void } | undefined;
  /**
   * A persistent, session-bound MCP server + transport carried by a Durable
   * Object (stateful sessions). When present, the `handleWebFetch` stage handles
   * the request on THIS transport instead of creating a fresh per-request one —
   * so the standalone GET notification stream stays open across requests and a
   * `tools/call`'s notifications reach it. The DO owns the lifecycle (no
   * per-request teardown). Absent in the stateless web path.
   */
  webTransport:
    | {
        mcpServer: unknown;
        transport: { handleRequest(request: Request, options?: { authInfo?: unknown }): Promise<Response> };
      }
    | undefined;
}

export const ServerRequestTokens = {
  type: tokenFactory.type('serverRequest'),
  intent: tokenFactory.meta('intent'),
  auth: tokenFactory.meta('auth'),
  sessionId: tokenFactory.meta('sessionId'),
  reinitialize: tokenFactory.meta('reinitialize'),
  webRequest: tokenFactory.meta('webRequest'),
  webCtx: tokenFactory.meta('webCtx'),
  webTransport: tokenFactory.meta('webTransport'),
} satisfies RawMetadataShape<ServerRequestTokenValue>;
