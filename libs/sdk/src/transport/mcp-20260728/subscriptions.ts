/**
 * `subscriptions/listen` — protocol 2026-07-28, SEP-2575.
 *
 * Replaces the standalone HTTP GET stream and the
 * `resources/subscribe` / `resources/unsubscribe` RPC pair with ONE long-lived
 * POST-response stream. Two rules shape the implementation:
 *
 * - **Opt-in only.** The server MUST NOT push a notification type the client
 *   did not name in the request's filter.
 * - **Acknowledge first.** The acknowledgement MUST be the first message
 *   carrying the subscription's id, so a client never sees a change
 *   notification before it knows which of its requests was honored.
 *
 * The stream is produced as an `AsyncIterable<Uint8Array>` of SSE frames rather
 * than by writing to a runtime-specific response object, so the same code
 * renders on Node and on a Web `Response` body.
 */
import { MCP_20260728_META, SUBSCRIPTIONS_ACKNOWLEDGED_METHOD, type SubscriptionFilter } from '@frontmcp/protocol';

import { type Scope } from '../../scope';

/** How often a bare SSE comment is emitted to hold the connection open. */
const KEEPALIVE_INTERVAL_MS = 15_000;

export interface SubscriptionStreamOptions {
  scope: Scope;
  /** JSON-RPC id of the `subscriptions/listen` request; doubles as the stream id. */
  subscriptionId: string | number;
  /** Notification types the client asked for. */
  requested: SubscriptionFilter;
  /** Fires when the client disconnects so the registry listeners are released. */
  signal?: AbortSignal;
}

/**
 * Narrow the client's filter to what this scope can actually deliver.
 *
 * A server that has no prompts cannot honor `promptsListChanged`; the spec says
 * to omit it from the acknowledgement rather than accept and stay silent, so
 * the client knows not to wait for it.
 */
export function resolveAcknowledgedFilter(scope: Scope, requested: SubscriptionFilter): SubscriptionFilter {
  const acknowledged: SubscriptionFilter = {};

  if (requested.toolsListChanged && scope.tools.getCapabilities().tools?.listChanged) {
    acknowledged.toolsListChanged = true;
  }
  if (requested.promptsListChanged && scope.prompts.getCapabilities().prompts?.listChanged) {
    acknowledged.promptsListChanged = true;
  }
  if (requested.resourcesListChanged && scope.resources.getCapabilities().resources?.listChanged) {
    acknowledged.resourcesListChanged = true;
  }
  if (requested.resourceSubscriptions && requested.resourceSubscriptions.length > 0) {
    acknowledged.resourceSubscriptions = [...requested.resourceSubscriptions];
  }

  return acknowledged;
}

const encoder = new TextEncoder();

/**
 * Serialize one JSON-RPC message as an SSE `message` event.
 *
 * Emitted as bytes so the same iterable feeds the Node writer and a Web
 * `Response` body without a per-runtime conversion step.
 */
function frame(message: unknown): Uint8Array {
  return encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

/** A bare SSE comment — ignored by clients, keeps intermediaries from timing out. */
const KEEPALIVE_FRAME = encoder.encode(':\n\n');

interface QueuedNotification {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Build the SSE body for a `subscriptions/listen` request.
 *
 * Returns the acknowledged filter alongside the stream so the caller can log or
 * assert on it without consuming the stream.
 */
export function createSubscriptionStream(options: SubscriptionStreamOptions): {
  acknowledged: SubscriptionFilter;
  stream: AsyncIterable<Uint8Array>;
} {
  const { scope, subscriptionId, requested, signal } = options;
  const acknowledged = resolveAcknowledgedFilter(scope, requested);

  const queue: QueuedNotification[] = [];
  let notify: (() => void) | undefined;
  let closed = false;

  const push = (method: string, params: Record<string, unknown> = {}): void => {
    if (closed) return;
    queue.push({ method, params });
    notify?.();
  };

  const unsubscribes: Array<() => void> = [];

  if (acknowledged.toolsListChanged) {
    unsubscribes.push(scope.tools.subscribe({}, () => push('notifications/tools/list_changed')));
  }
  if (acknowledged.promptsListChanged) {
    unsubscribes.push(scope.prompts.subscribe({}, () => push('notifications/prompts/list_changed')));
  }

  const watchedUris = new Set(acknowledged.resourceSubscriptions ?? []);
  if (acknowledged.resourcesListChanged || watchedUris.size > 0) {
    unsubscribes.push(
      scope.resources.subscribe({}, (event) => {
        const updatedUri = (event as { updatedUri?: unknown }).updatedUri;
        const uri = typeof updatedUri === 'string' ? updatedUri : undefined;
        if (event.kind === 'updated') {
          // A subscription is on a URI prefix, so a sub-resource update counts.
          if (uri && [...watchedUris].some((watched) => uri === watched || uri.startsWith(watched))) {
            push('notifications/resources/updated', { uri });
          }
          return;
        }
        if (acknowledged.resourcesListChanged) {
          push('notifications/resources/list_changed');
        }
      }),
    );
  }

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    for (const unsubscribe of unsubscribes) {
      try {
        unsubscribe();
      } catch {
        // A listener that is already detached is not an error worth surfacing.
      }
    }
    notify?.();
  };

  signal?.addEventListener('abort', cleanup, { once: true });

  async function* generate(): AsyncIterable<Uint8Array> {
    try {
      // MUST be the first message carrying this subscription's id.
      yield frame({
        jsonrpc: '2.0',
        method: SUBSCRIPTIONS_ACKNOWLEDGED_METHOD,
        params: {
          notifications: acknowledged,
          _meta: { [MCP_20260728_META.subscriptionId]: subscriptionId },
        },
      });

      for (;;) {
        while (queue.length > 0) {
          const next = queue.shift() as QueuedNotification;
          yield frame({
            jsonrpc: '2.0',
            method: next.method,
            params: {
              ...next.params,
              _meta: { [MCP_20260728_META.subscriptionId]: subscriptionId },
            },
          });
        }

        if (closed || signal?.aborted) break;

        const woke = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            notify = undefined;
            resolve(false);
          }, KEEPALIVE_INTERVAL_MS);
          notify = () => {
            clearTimeout(timer);
            notify = undefined;
            resolve(true);
          };
        });

        // Timed out with nothing queued — emit an SSE comment so intermediaries
        // and idle timeouts don't tear down a healthy but quiet stream.
        if (!woke && !closed && !signal?.aborted) yield KEEPALIVE_FRAME;
      }
    } finally {
      cleanup();
    }
  }

  return { acknowledged, stream: generate() };
}
