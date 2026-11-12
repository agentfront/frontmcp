/**
 * Read an HTTP response body without holding more than a set number of bytes.
 *
 * `response.text()` and `response.arrayBuffer()` buffer the whole body before a caller can check its size, and the
 * body `fetch` hands over is already decompressed, so a small compressed response can expand without limit. These
 * helpers stop reading, and cancel the body, as soon as the limit is passed.
 */

/**
 * Thrown when a response body is larger than the limit given to {@link readBodyWithLimit} or
 * {@link readTextWithLimit}.
 */
export class ResponseTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Response body exceeds the limit of ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
    this.maxBytes = maxBytes;
  }
}

/** The parts of a fetch `Response` the readers use, so tests and wrappers can pass look-alikes. */
export interface LimitedBodySource {
  readonly headers?: { get(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

function checkLimit(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError(`maxBytes must be a non-negative finite number, got ${maxBytes}`);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Read a response body, failing with {@link ResponseTooLargeError} once it passes `maxBytes`.
 *
 * A `Content-Length` above the limit fails before any byte is read. Otherwise the body stream is read chunk by
 * chunk and cancelled as soon as the running total passes the limit, so at most `maxBytes` plus one chunk is held.
 * The limit applies to the bytes `fetch` delivers, which are already decompressed.
 *
 * A look-alike response without a `body` stream is read with `arrayBuffer()` or `text()` and then checked; only real
 * streams are bounded while reading.
 *
 * @param response - A fetch `Response`, or an object with the same `headers`, `body`, `arrayBuffer` or `text`
 * @param maxBytes - The largest body accepted, in bytes
 * @returns The body bytes
 * @throws ResponseTooLargeError when the body is larger than `maxBytes`
 *
 * @example
 * ```typescript
 * const res = await fetch(url);
 * const bytes = await readBodyWithLimit(res, 1024 * 1024);
 * ```
 */
export async function readBodyWithLimit(response: LimitedBodySource, maxBytes: number): Promise<Uint8Array> {
  checkLimit(maxBytes);

  const declared = response.headers?.get('content-length');
  if (declared !== null && declared !== undefined && declared.trim() !== '') {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(maxBytes);
    }
  }

  const body = response.body;
  if (!body) {
    let bytes: Uint8Array;
    if (typeof response.arrayBuffer === 'function') {
      bytes = new Uint8Array(await response.arrayBuffer());
    } else if (typeof response.text === 'function') {
      bytes = new TextEncoder().encode(await response.text());
    } else {
      bytes = new Uint8Array(0);
    }
    if (bytes.byteLength > maxBytes) throw new ResponseTooLargeError(maxBytes);
    return bytes;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concat(chunks, total);
}

/**
 * Read a response body as UTF-8 text, failing with {@link ResponseTooLargeError} once it passes `maxBytes`.
 * See {@link readBodyWithLimit}.
 *
 * @param response - A fetch `Response`, or an object with the same `headers`, `body`, `arrayBuffer` or `text`
 * @param maxBytes - The largest body accepted, in bytes (of UTF-8, before decoding)
 * @returns The decoded text
 * @throws ResponseTooLargeError when the body is larger than `maxBytes`
 */
export async function readTextWithLimit(response: LimitedBodySource, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBodyWithLimit(response, maxBytes));
}
