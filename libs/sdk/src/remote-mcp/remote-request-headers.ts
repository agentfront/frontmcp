import { AsyncLocalStorage } from '@frontmcp/utils';

const callerHeaders = new AsyncLocalStorage<Record<string, string>>();

/** Runs `operation` so that every request a remote transport sends while it runs carries `headers`. */
export function withRemoteRequestHeaders<T>(headers: Record<string, string>, operation: () => Promise<T>): Promise<T> {
  return Object.keys(headers).length > 0 ? callerHeaders.run(headers, operation) : operation();
}

/** The `fetch` the remote transports send through: it adds the headers of the running {@link withRemoteRequestHeaders}. */
export function fetchWithRemoteRequestHeaders(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const extra = callerHeaders.getStore();
  if (!extra) return fetch(input, init);
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return fetch(input, { ...init, headers });
}
