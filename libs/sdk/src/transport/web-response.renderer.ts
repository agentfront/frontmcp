/**
 * Render a normalized {@link HttpOutput} (the `http:request` flow's output) to a
 * Web `Response`. This is the web-fetch (worker) analog of the Node
 * `writeHttpResponse` renderer — it lets a V8-isolate adapter run the SAME flow
 * every other transport runs and render its normalized result, instead of
 * bypassing the pipeline.
 *
 * Returns `undefined` for outputs that mean "no response produced" (`next`,
 * `consumed`) so the caller can fall through (e.g. to a 404).
 */
import { type HttpOutput } from '../common/schemas/http-output.schema';

const encoder = new TextEncoder();

/** Turn an AsyncIterable / Readable-like into a Web ReadableStream of bytes. */
function toByteStream(streamLike: unknown): ReadableStream<Uint8Array> {
  const iter = (streamLike as { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string> })[
    Symbol.asyncIterator
  ];
  if (typeof iter !== 'function') {
    // Not async-iterable (e.g. a Node-only `pipe`-able). Emit nothing rather
    // than throw — the worker path produces async-iterable bodies.
    return new ReadableStream<Uint8Array>({ start: (c) => c.close() });
  }
  const it = iter.call(streamLike);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value);
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}

function bytesFrom(body: string | Uint8Array, encoding?: string): Uint8Array {
  if (typeof body !== 'string') return body;
  if (encoding === 'base64') return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (encoding === 'hex') {
    const out = new Uint8Array(body.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return encoder.encode(body);
}

/** Build a Headers object from the output's `headers` + `cookies` metadata. */
function buildHeaders(out: Record<string, unknown>, contentType?: string): Headers {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  const extra = out['headers'] as Record<string, string> | undefined;
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  const cookies = out['cookies'] as string[] | undefined;
  if (Array.isArray(cookies)) for (const c of cookies) headers.append('Set-Cookie', c);
  return headers;
}

export function renderHttpOutputToWebResponse(output: HttpOutput): Response | undefined {
  const out = output as HttpOutput & Record<string, unknown>;

  switch (out.kind) {
    // Already a Web Response (the MCP execute stage on a worker) — return verbatim.
    case 'web-response':
      return out.response;

    // "no response" — let the adapter fall through (404 / next middleware).
    case 'next':
    case 'consumed':
      return undefined;

    case 'redirect': {
      const headers = buildHeaders(out);
      headers.set('Location', out.location);
      return new Response(null, { status: out.status, headers });
    }

    case 'json':
    case 'jsonrpc':
    case 'problem':
      return new Response(JSON.stringify(out.body), { status: out.status, headers: buildHeaders(out, out.contentType) });

    case 'text':
    case 'html':
      return new Response(out.body, { status: out.status, headers: buildHeaders(out, out.contentType) });

    case 'binary':
    case 'image': {
      const headers = buildHeaders(out, out.contentType);
      headers.set(
        'Content-Disposition',
        out.filename ? `${out.disposition}; filename="${out.filename}"` : out.disposition,
      );
      return new Response(bytesFrom(out.body, out.encoding) as BodyInit, { status: out.status, headers });
    }

    case 'stream':
    case 'sse': {
      const headers = buildHeaders(out, out.contentType);
      if (out.kind === 'sse' && !headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache');
      return new Response(toByteStream(out.stream), { status: out.status, headers });
    }

    case 'empty':
      return new Response(null, { status: out.status, headers: buildHeaders(out) });

    default:
      return undefined;
  }
}
