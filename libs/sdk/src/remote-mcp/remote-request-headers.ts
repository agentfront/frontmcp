import { AsyncLocalStorage } from '@frontmcp/utils';

const callerHeaders = new AsyncLocalStorage<Record<string, string>>();

/** Runs `operation` so that every request a remote transport sends while it runs carries `headers`. */
export function withRemoteRequestHeaders<T>(headers: Record<string, string>, operation: () => Promise<T>): Promise<T> {
  return Object.keys(headers).length > 0 ? callerHeaders.run(headers, operation) : operation();
}

/**
 * The `fetch` the remote transports send through: it adds the headers of the running
 * {@link withRemoteRequestHeaders}. While a request carries credentials (the connection's own headers,
 * or a caller's), a redirect is not followed, so they cannot reach an origin the remote sent it to.
 *
 * @param connectionCarriesHeaders - Whether the connection sends its own headers (`transportOptions.headers`, static `remoteAuth`)
 */
export function createRemoteRequestFetch(connectionCarriesHeaders: boolean): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const extra = callerHeaders.getStore();
    const carriesCredentials = connectionCarriesHeaders || extra !== undefined;
    if (!carriesCredentials) return fetch(input, init);

    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
    const redirect = init?.redirect === 'error' ? 'error' : 'manual';
    return fetch(input, { ...init, headers, redirect });
  };
}
