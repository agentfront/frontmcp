/**
 * createRemoteEventForwarder — publish MCP Events on another FrontMCP server through its HTTP publish endpoint
 * (`events.publishEndpoint`, bearer mode), with the signed-in user's token.
 *
 * @example
 * ```ts
 * const remote = createRemoteEventForwarder({
 *   url: 'https://api.example.com/events/publish',
 *   getToken: () => auth.getAccessToken(),
 * });
 * await remote.forward('cart.checked_out', { cartId });
 * ```
 */

import type { EventPublishOptions, EventPublishResult } from '@frontmcp/sdk';

export interface RemoteEventForwarderOptions {
  /** The publish endpoint of the remote server, `/events/publish` by default there. */
  url: string;
  /** The bearer token to send; none sends no `Authorization` header. */
  getToken: () => string | undefined | null | Promise<string | undefined | null>;
  /** The `fetch` to use. @default globalThis.fetch */
  fetch?: typeof fetch;
}

export interface RemoteEventForwarder {
  /** POST one event; resolves with the remote `{ eventId, matched }`. */
  forward(name: string, data: Record<string, unknown>, options?: EventPublishOptions): Promise<EventPublishResult>;
}

/** The remote endpoint did not accept the event: 401/403 credentials, 404 unknown event, 422 invalid data, 413 size. */
export class RemoteEventForwardError extends Error {
  /** Carries the HTTP status and the body the endpoint answered with. */
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`The remote publish endpoint answered ${status}: ${body.slice(0, 200)}`);
    this.name = 'RemoteEventForwardError';
  }
}

/** A forwarder that POSTs `{ name, data, ...options }` as JSON to `url` with the user's bearer token. */
export function createRemoteEventForwarder(options: RemoteEventForwarderOptions): RemoteEventForwarder {
  return {
    async forward(name, data, publishOptions = {}) {
      const token = await options.getToken();
      const response = await (options.fetch ?? globalThis.fetch.bind(globalThis))(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name, data, ...publishOptions }),
      });
      if (!response.ok) throw new RemoteEventForwardError(response.status, await response.text());
      return (await response.json()) as EventPublishResult;
    },
  };
}
