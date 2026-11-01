// file: plugins/plugin-skilled-openapi/src/executor/pinned-fetch.ts

import type { LookupAddress } from 'node:dns';
import type * as Http from 'node:http';
import type * as Stream from 'node:stream';
import type * as Zlib from 'node:zlib';

/** Statuses the Fetch API gives no body, as it does a HEAD response; `new Response` refuses one with a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * The content codings `fetch` decodes, and the decoder for each, flushing as `fetch` does so that an
 * empty or truncated body yields what it holds rather than an error.
 */
const DECODERS = new Map<string, (zlib: typeof Zlib) => Stream.Transform>([
  ['gzip', (zlib) => zlib.createGunzip(zlibSyncFlush(zlib))],
  ['x-gzip', (zlib) => zlib.createGunzip(zlibSyncFlush(zlib))],
  ['deflate', (zlib) => zlib.createInflate(zlibSyncFlush(zlib))],
  [
    'br',
    (zlib) =>
      zlib.createBrotliDecompress({
        flush: zlib.constants.BROTLI_OPERATION_FLUSH,
        finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
      }),
  ],
]);

function zlibSyncFlush(zlib: typeof Zlib): Zlib.ZlibOptions {
  return { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
}

/**
 * `fetch` that connects only to `addresses`, the DNS answer the outbound check judged. `fetch`
 * resolves the hostname again, and a second answer can name an address the check never saw. The
 * hostname still goes in `Host` and names the TLS server (SNI and the certificate check).
 *
 * Node.js only. It sends a string body or none, sends `fetch`'s default `accept`, `accept-encoding`
 * and `user-agent` when the request has none, decodes a compressed body as `fetch` does, and opens
 * a connection per request: a pooled one may lead elsewhere. The module names are not literals, so
 * Worker bundles never pull them in.
 */
export function pinnedFetch(addresses: readonly LookupAddress[]): typeof fetch {
  const lookup = pinnedLookup(addresses);
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const transportModuleName = url.protocol === 'https:' ? 'node:https' : 'node:http';
    const streamModuleName = 'node:stream';
    const zlibModuleName = 'node:zlib';
    const { request } = (await import(transportModuleName)) as typeof Http;
    const stream = (await import(streamModuleName)) as typeof Stream;
    const zlib = (await import(zlibModuleName)) as typeof Zlib;

    const headers = new Headers(init.headers);
    const body = init.body as string | undefined;
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate');
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
    if (NULL_BODY_STATUSES.has(status) || init.method?.toUpperCase() === 'HEAD') {
      incoming.resume();
      return new Response(null, { status, headers: responseHeaders });
    }
    const decoded = decodeBody(incoming, stream, zlib);
    const responseBody = stream.Readable.toWeb(decoded) as unknown as ReadableStream<Uint8Array>;
    return new Response(responseBody, { status, headers: responseHeaders });
  }) as typeof fetch;
}

/** The body with its `content-encoding` undone, as `fetch` gives it; an unknown coding is left as sent. */
function decodeBody(incoming: Http.IncomingMessage, stream: typeof Stream, zlib: typeof Zlib): Stream.Readable {
  const encoding = incoming.headers['content-encoding']?.trim().toLowerCase() ?? '';
  const createDecoder = DECODERS.get(encoding);
  if (!createDecoder) return incoming;
  const decoder = createDecoder(zlib);
  // A failure destroys the decoder with its error, which the body's reader then gets.
  stream.pipeline(incoming, decoder, () => undefined);
  return decoder;
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
