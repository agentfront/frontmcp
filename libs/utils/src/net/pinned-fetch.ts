import type { LookupAddress } from 'node:dns';
import type * as Http from 'node:http';
import type { LookupFunction } from 'node:net';
import type * as Stream from 'node:stream';
import type * as Zlib from 'node:zlib';

/** Statuses the Fetch API gives no body, as it does a HEAD response; `new Response` refuses one with a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** The most content codings a response may list, as `fetch` allows. */
const MAX_CONTENT_CODINGS = 5;

type DecoderFactory = (zlib: typeof Zlib) => Stream.Transform;

/**
 * The content codings `fetch` decodes, and the decoder for each, flushing as `fetch` does so that an
 * empty or truncated body yields what it holds rather than an error.
 */
const DECODERS = new Map<string, DecoderFactory>([
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

/** The request `pinnedFetch` sends: a string body or none. */
export type PinnedRequestInit = Omit<RequestInit, 'body'> & { body?: string };

/** A `fetch` for a URL, not a `Request`, with a string body or none. */
export type PinnedFetch = (input: string | URL, init?: PinnedRequestInit) => Promise<Response>;

/**
 * `fetch` that connects only to `addresses`, the DNS answer an outbound check judged. `fetch`
 * resolves the hostname again, and a second answer can name an address the check never saw. The
 * hostname still goes in `Host` and names the TLS server (SNI and the certificate check).
 *
 * Node.js only. It sends a string body or none, sends `fetch`'s default `accept`, `accept-encoding`
 * and `user-agent` when the request has none, decodes a compressed body as `fetch` does, does not
 * follow a redirect, and opens a connection per request: a pooled one may lead elsewhere.
 */
export function pinnedFetch(addresses: readonly LookupAddress[]): PinnedFetch {
  const lookup = pinnedLookup(addresses);
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const transport: typeof Http = url.protocol === 'https:' ? require('node:https') : require('node:http');
    const stream: typeof Stream = require('node:stream');
    const zlib: typeof Zlib = require('node:zlib');

    const headers = new Headers(init.headers);
    const { body } = init;
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate');
    if (!headers.has('user-agent')) headers.set('user-agent', 'node');
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    const outgoingHeaders: Record<string, string> = {};
    headers.forEach((value, name) => {
      outgoingHeaders[name] = value;
    });

    const incoming = await new Promise<Http.IncomingMessage>((resolve, reject) => {
      const outgoing = transport.request(
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
    const statusText = incoming.statusMessage ?? '';
    const responseHeaders = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
    }
    if (NULL_BODY_STATUSES.has(status) || init.method?.toUpperCase() === 'HEAD') {
      incoming.resume();
      return new Response(null, { status, statusText, headers: responseHeaders });
    }
    const decoded = decodeBody(incoming, stream, zlib);
    const responseBody = stream.Readable.toWeb(decoded) as unknown as ReadableStream<Uint8Array>;
    return new Response(responseBody, { status, statusText, headers: responseHeaders });
  };
}

/**
 * The body with its `content-encoding` codings undone, last applied first, as `fetch` gives it. A list
 * with a coding `fetch` does not decode is left as sent, and one longer than `fetch` allows is refused.
 */
function decodeBody(incoming: Http.IncomingMessage, stream: typeof Stream, zlib: typeof Zlib): Stream.Readable {
  const codings = (incoming.headers['content-encoding'] ?? '')
    .split(',')
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding.length > 0);
  if (codings.length > MAX_CONTENT_CODINGS) {
    incoming.destroy();
    throw new Error(`too many content-encodings in response: ${codings.length}, at most ${MAX_CONTENT_CODINGS}`);
  }
  const decoderFactories = codings.reverse().map((coding) => DECODERS.get(coding));
  const decodable = decoderFactories.every((factory): factory is DecoderFactory => factory !== undefined);
  if (codings.length === 0 || !decodable) return incoming;

  const decoders = decoderFactories.map((createDecoder) => createDecoder(zlib));
  // A failure destroys every stage with its error, which the body's reader then gets from the last.
  stream.pipeline([incoming, ...decoders], () => undefined);
  return decoders[decoders.length - 1];
}

/** A `lookup` that answers with the checked addresses only, in whichever shape the connection asks for. */
export function pinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [...addresses]);
      return;
    }
    const [first] = addresses;
    callback(null, first.address, first.family);
  };
}
