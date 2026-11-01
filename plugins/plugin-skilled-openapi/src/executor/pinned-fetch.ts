// file: plugins/plugin-skilled-openapi/src/executor/pinned-fetch.ts

import type { LookupAddress } from 'node:dns';
import type * as Http from 'node:http';
import type * as Stream from 'node:stream';

/** Statuses the Fetch API gives no body; `new Response` refuses one with a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * `fetch` that connects only to `addresses`, the DNS answer the outbound check judged. `fetch`
 * resolves the hostname again, and a second answer can name an address the check never saw. The
 * hostname still goes in `Host` and names the TLS server (SNI and the certificate check).
 *
 * Node.js only. It sends a string body or none, sends `fetch`'s default `accept` and `user-agent`
 * when the request has none, and opens a connection per request: a pooled one may lead elsewhere.
 * The module names are not literals, so Worker bundles never pull them in.
 */
export function pinnedFetch(addresses: readonly LookupAddress[]): typeof fetch {
  const lookup = pinnedLookup(addresses);
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const transportModuleName = url.protocol === 'https:' ? 'node:https' : 'node:http';
    const streamModuleName = 'node:stream';
    const { request } = (await import(transportModuleName)) as typeof Http;
    const { Readable } = (await import(streamModuleName)) as typeof Stream;

    const headers = new Headers(init.headers);
    const body = init.body as string | undefined;
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('user-agent')) headers.set('user-agent', 'node');
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    const outgoingHeaders: Record<string, string> = {};
    headers.forEach((value, name) => {
      outgoingHeaders[name] = value;
    });

    const incoming = await new Promise<Http.IncomingMessage>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: init.method,
          headers: outgoingHeaders,
          signal: init.signal ?? undefined,
          lookup,
          agent: false,
        },
        resolve,
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });

    const status = incoming.statusCode ?? 0;
    const responseHeaders = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
    }
    if (NULL_BODY_STATUSES.has(status)) {
      incoming.resume();
      return new Response(null, { status, headers: responseHeaders });
    }
    const responseBody = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
    return new Response(responseBody, { status, headers: responseHeaders });
  }) as typeof fetch;
}

/** A `lookup` for the connection that answers with `addresses`, in whichever shape it asks for. */
function pinnedLookup(addresses: readonly LookupAddress[]): NonNullable<Http.RequestOptions['lookup']> {
  return ((_hostname, options, callback) => {
    if (options.all) {
      callback(null, [...addresses]);
      return;
    }
    const [first] = addresses;
    callback(null, first.address, first.family);
  }) as NonNullable<Http.RequestOptions['lookup']>;
}
