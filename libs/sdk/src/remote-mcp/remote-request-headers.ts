import { AsyncLocalStorage } from '@frontmcp/utils';

import { retryAfterMsOf } from '../transport/mcp-20260728/client/mcp-stateless.client';
import { remoteHttpFailureOf, type RemoteHttpFailure } from './resilience/retry';

interface RemoteRequestScope {
  headers: Record<string, string>;
  refusal?: RemoteHttpFailure;
}

const requestScopes = new AsyncLocalStorage<RemoteRequestScope>();

/**
 * Runs `operation` so that every request a remote transport sends while it runs carries `headers`. When it fails
 * after the remote refused a request, the failure carries that response's `Retry-After` (as the 2026-07-28 client's
 * failures do), which a retry waits for.
 */
export async function withRemoteRequestHeaders<T>(
  headers: Record<string, string>,
  operation: () => Promise<T>,
): Promise<T> {
  const scope: RemoteRequestScope = { headers };
  try {
    return await requestScopes.run(scope, operation);
  } catch (error) {
    throw withRefusal(error, scope.refusal);
  }
}

/** `error`, with the `Retry-After` of the refused response that caused it when its own failure has none. */
function withRefusal(error: unknown, refusal: RemoteHttpFailure | undefined): unknown {
  const failure = remoteHttpFailureOf(error);
  if (refusal?.retryAfterMs === undefined || failure?.status !== refusal.status || failure.retryAfterMs !== undefined) {
    return error;
  }
  return Object.assign(error as object, { http: refusal });
}

/**
 * The `fetch` the remote transports send through: it adds the headers of the running
 * {@link withRemoteRequestHeaders}. While a request carries credentials (the connection's own headers,
 * or a caller's), a redirect is not followed, so they cannot reach an origin the remote sent it to.
 *
 * @param connectionCarriesHeaders - Whether the connection sends its own headers (`transportOptions.headers`, static `remoteAuth`)
 */
export function createRemoteRequestFetch(connectionCarriesHeaders: boolean): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const scope = requestScopes.getStore();
    const extra = scope?.headers ?? {};
    const carriesCredentials = connectionCarriesHeaders || Object.keys(extra).length > 0;
    const response = carriesCredentials ? await fetch(input, withHeaders(init, extra)) : await fetch(input, init);
    if (scope && response.status >= 400) {
      scope.refusal = { status: response.status, retryAfterMs: retryAfterMsOf(response.headers.get('retry-after')) };
    }
    return response;
  };
}

function withHeaders(init: RequestInit | undefined, extra: Record<string, string>): RequestInit {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  const redirect = init?.redirect === 'error' ? 'error' : 'manual';
  return { ...init, headers, redirect };
}
