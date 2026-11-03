import * as http from 'node:http';
import { Readable } from 'node:stream';

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

/**
 * A `fetch` that sends every request to the HTTP server on `socketPath`, whatever host its URL names, each on a
 * connection of its own: a server that exits refuses it, or nothing listens, and is never left to drop it.
 */
export function unixSocketFetch(socketPath: string): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const request = http.request(
        {
          socketPath,
          agent: false,
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? 'GET',
          headers: headersOf(init),
          signal: init?.signal ?? undefined,
        },
        (response) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          const status = response.statusCode ?? 502;
          if (status === 204 || status === 304 || response.headers['content-length'] === '0') {
            response.resume();
            resolve(new Response(null, { status, headers }));
            return;
          }
          resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
        },
      );
      request.on('error', reject);
      request.end(typeof init?.body === 'string' ? init.body : undefined);
    });
}
