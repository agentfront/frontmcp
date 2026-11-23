import { AsyncLocalStorage } from '@frontmcp/utils';

import { retryAfterMsOf } from '../transport/mcp-20260728/client/mcp-stateless.client';
import { type RemoteOAuthTokenSource } from './remote-oauth';
import { remoteHttpFailureOf, type RemoteHttpFailure } from './resilience/retry';

interface RemoteRequestScope {
  headers: Record<string, string>;
  refusal?: RemoteHttpFailure;
}

/**
 * One storage per remote app, so a call's headers reach only the remote it was made to. Without `AsyncContext` a
 * storage answers with the newest open call of the request, and calls to two remotes then never share one.
 */
const requestScopesByApp = new Map<string, AsyncLocalStorage<RemoteRequestScope>>();

function requestScopesOf(appId: string): AsyncLocalStorage<RemoteRequestScope> {
  let requestScopes = requestScopesByApp.get(appId);
  if (!requestScopes) {
    requestScopes = new AsyncLocalStorage<RemoteRequestScope>();
    requestScopesByApp.set(appId, requestScopes);
  }
  return requestScopes;
}

/**
 * Runs `operation` so that every request the transport of `appId` sends while it runs carries `headers`. When it fails
 * after the remote refused a request, the failure carries that response's `Retry-After` (as the 2026-07-28 client's
 * failures do), which a retry waits for.
 */
export async function withRemoteRequestHeaders<T>(
  appId: string,
  headers: Record<string, string>,
  operation: () => Promise<T>,
): Promise<T> {
  const scope: RemoteRequestScope = { headers };
  try {
    return await requestScopesOf(appId).run(scope, operation);
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
 * The `fetch` the transport of `appId` sends through: it adds the headers of the running
 * {@link withRemoteRequestHeaders} for `appId`. While a request carries credentials (the connection's own headers,
 * or a caller's), a redirect is not followed, so they cannot reach an origin the remote sent it to.
 *
 * @param appId - The remote app whose calls' headers the requests carry
 * @param connectionCarriesHeaders - Whether the connection sends its own headers (`transportOptions.headers`, static `remoteAuth`)
 * @param oauth - The OAuth token every request carries; a request the remote refuses with 401 is sent once more with a new token
 */
export function createRemoteRequestFetch(
  appId: string,
  connectionCarriesHeaders: boolean,
  oauth?: RemoteOAuthTokenSource,
): typeof fetch {
  const requestScopes = requestScopesOf(appId);
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const scope = requestScopes.getStore();
    const extra = scope?.headers ?? {};
    const carriesCredentials = connectionCarriesHeaders || oauth !== undefined || Object.keys(extra).length > 0;
    const send = async () => {
      const credentials: Record<string, string> = oauth ? { authorization: await oauth.authorization() } : {};
      return carriesCredentials ? fetch(input, withHeaders(init, { ...credentials, ...extra })) : fetch(input, init);
    };
    let response = await send();
    if (oauth && response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      oauth.invalidate();
      response = await send();
    }
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
