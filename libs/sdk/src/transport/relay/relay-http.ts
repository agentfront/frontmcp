/**
 * Request and response objects for an HTTP request relayed between the nodes of a
 * distributed deployment.
 *
 * The node that receives a request for a session another node owns serializes it
 * ({@link serializeRelayRequest}). The owner rebuilds a `ServerRequest` from it
 * ({@link createRelayedServerRequest}) and runs it through its own `http:request`
 * flow with a {@link RelayServerResponse}, whose output is streamed back.
 *
 * Both objects implement the subset of Node's `IncomingMessage` / `ServerResponse`
 * (and Express' `status` / `json` / `send`) that the flows, the transport adapters
 * and the MCP SDK's Streamable HTTP and SSE transports use. They depend on no Node
 * built-in module, so importing them is safe in every runtime.
 */

import { base64Decode, base64Encode } from '@frontmcp/utils';

import { ServerRequestTokens, type ServerRequest, type ServerResponse } from '../../common';
import type { RelayedHttpRequest } from '../../ha/relay-messages';

type Listener = (...args: unknown[]) => void;

/** Minimal event emitter (no dependency on Node's `events`). */
class RelayEmitter {
  private readonly listeners = new Map<string | symbol, Listener[]>();

  on(event: string | symbol, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    (wrapper as Listener & { listener?: Listener }).listener = listener;
    return this.on(event, wrapper);
  }

  off(event: string | symbol, listener: Listener): this {
    const list = this.listeners.get(event);
    if (!list) return this;
    const index = list.findIndex(
      (l) => l === listener || (l as Listener & { listener?: Listener }).listener === listener,
    );
    if (index >= 0) list.splice(index, 1);
    if (list.length === 0) this.listeners.delete(event);
    return this;
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }

  listenerCount(event: string | symbol): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return false;
    for (const listener of [...list]) listener(...args);
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

/** Header values a relayed request keeps (strings only; `undefined` dropped). */
function normalizeRequestHeaders(headers: Record<string, unknown> | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!headers) return out;
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
    else if (Array.isArray(value)) out[name.toLowerCase()] = value.map(String);
    else if (typeof value === 'number') out[name.toLowerCase()] = String(value);
  }
  return out;
}

/** Serialize a request this node received so its session owner can serve it. */
export function serializeRelayRequest(request: ServerRequest): RelayedHttpRequest {
  const raw = request as unknown as {
    originalUrl?: string;
    url?: string;
    path?: string;
    method?: string;
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    protocol?: string;
    socket?: { remoteAddress?: string; encrypted?: boolean };
  };
  const url = typeof raw.originalUrl === 'string' && raw.originalUrl ? raw.originalUrl : (raw.url ?? '/');
  const queryIndex = url.indexOf('?');
  const path = typeof raw.path === 'string' && raw.path ? raw.path : queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  return {
    method: (raw.method ?? 'GET').toUpperCase(),
    url,
    path,
    headers: normalizeRequestHeaders(raw.headers),
    query: raw.query && typeof raw.query === 'object' ? { ...raw.query } : {},
    ...(raw.body !== undefined ? { body: raw.body } : {}),
    ...(typeof raw.protocol === 'string' ? { protocol: raw.protocol } : {}),
    ...(raw.socket?.encrypted ? { encrypted: true } : {}),
    ...(typeof raw.socket?.remoteAddress === 'string' ? { peerAddress: raw.socket.remoteAddress } : {}),
  };
}

/** The node that relayed this request, when it was relayed. */
export function relayedFrom(request: ServerRequest): string | undefined {
  const value = (request as unknown as Record<PropertyKey, unknown>)[ServerRequestTokens.relayedFrom];
  return typeof value === 'string' ? value : undefined;
}

/** Whether a request was relayed here from another node. */
export function isRelayedRequest(request: ServerRequest): boolean {
  return relayedFrom(request) !== undefined;
}

/**
 * Rebuild the `ServerRequest` of a relayed request on the session owner.
 * Its socket peer is the client's address on the node that received the request,
 * so client-IP rules see the same client they would have seen there.
 *
 * It behaves as a request whose body has arrived: reading (`resume()`) ends it with `end`,
 * as `@hono/node-server` expects when it drains a request after the response; and its socket
 * has nothing to close.
 */
export function createRelayedServerRequest(relayed: RelayedHttpRequest, sourceNodeId: string): ServerRequest {
  const headers = normalizeRequestHeaders(relayed.headers);
  const rawHeaders: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) rawHeaders.push(name, item);
  }
  const socket = {
    remoteAddress: relayed.peerAddress,
    encrypted: relayed.encrypted === true,
    destroyed: false,
    destroy(): void {
      socket.destroyed = true;
    },
    destroySoon(): void {
      socket.destroyed = true;
    },
  };
  const request = Object.assign(new RelayEmitter(), {
    method: relayed.method,
    url: relayed.url,
    originalUrl: relayed.url,
    path: relayed.path,
    headers,
    rawHeaders,
    query: relayed.query ?? {},
    body: relayed.body,
    protocol: relayed.protocol ?? (socket.encrypted ? 'https' : 'http'),
    secure: (relayed.protocol ?? (socket.encrypted ? 'https' : 'http')) === 'https',
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    complete: true,
    readable: false,
    readableEnded: false,
    aborted: false,
    errored: null,
    destroyed: false,
    socket,
    connection: socket,
    resume() {
      if (!request.readableEnded) {
        request.readableEnded = true;
        queueMicrotask(() => request.emit('end'));
      }
      return request;
    },
    pause() {
      return request;
    },
    destroy(): void {
      request.destroyed = true;
    },
  });
  // The MCP SDK's Node transport rebuilds a Web Request from this object; a body it
  // reads comes from `rawBody` instead of a stream (the parsed body is passed to it).
  if (relayed.body !== undefined && typeof Buffer !== 'undefined') {
    const text = typeof relayed.body === 'string' ? relayed.body : JSON.stringify(relayed.body);
    Object.assign(request, { rawBody: Buffer.from(text) });
  }
  (request as unknown as Record<PropertyKey, unknown>)[ServerRequestTokens.relayedFrom] = sourceNodeId;
  return request as unknown as ServerRequest;
}

/* ------------------------------------------------------------------ */
/* Response                                                            */
/* ------------------------------------------------------------------ */

/** A body chunk as carried in a relay frame. */
export interface RelayChunk {
  data: string;
  encoding: 'utf8' | 'base64';
}

/** Strict UTF-8 decoder: throws on invalid input and keeps a leading BOM. */
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Bytes as a frame chunk: text when they are valid UTF-8 (JSON, SSE), base64 otherwise. */
function encodeBytes(bytes: Uint8Array): RelayChunk | undefined {
  if (bytes.byteLength === 0) return undefined;
  try {
    return { data: utf8Decoder.decode(bytes), encoding: 'utf8' };
  } catch {
    // Binary, or a multi-byte character split across chunks.
    return { data: base64Encode(bytes), encoding: 'base64' };
  }
}

/** Encode a body chunk for a relay frame. Returns `undefined` for an empty chunk. */
export function encodeRelayChunk(chunk: unknown, encoding?: string): RelayChunk | undefined {
  if (chunk === undefined || chunk === null) return undefined;
  if (typeof chunk === 'string') {
    if (chunk.length === 0) return undefined;
    if (encoding === 'base64') return { data: chunk, encoding: 'base64' };
    return { data: chunk, encoding: 'utf8' };
  }
  if (chunk instanceof Uint8Array) return encodeBytes(chunk);
  if (chunk instanceof ArrayBuffer) return encodeBytes(new Uint8Array(chunk));
  const text = String(chunk);
  return text.length > 0 ? { data: text, encoding: 'utf8' } : undefined;
}

/** Decode a relay frame body chunk. */
export function decodeRelayChunk(chunk: RelayChunk): Uint8Array | string {
  return chunk.encoding === 'base64' ? base64Decode(chunk.data) : chunk.data;
}

/** Receives what the owner writes to a relayed response, in order. */
export interface RelayResponseSink {
  head(status: number, headers: Record<string, string | string[]>): void;
  data(chunk: RelayChunk): void;
  end(): void;
}

type OutgoingHeaderValue = number | string | readonly string[];
type OutgoingHeaders = Record<string, OutgoingHeaderValue | undefined> | readonly string[];

/** Hop-by-hop headers: they describe one connection, not the response. */
const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

/**
 * The response of a relayed request on the session owner. Whatever the flow writes
 * is handed to the {@link RelayResponseSink} (and from there published back to the
 * node that relayed the request). `destroy()` — called when that node's client goes
 * away — emits `close` before `finish`, which aborts a streaming MCP response.
 */
export class RelayServerResponse extends RelayEmitter {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;
  private readonly headerMap = new Map<string, string | string[]>();

  constructor(private readonly sink: RelayResponseSink) {
    super();
  }

  get writable(): boolean {
    return !this.writableEnded && !this.destroyed;
  }

  get finished(): boolean {
    return this.writableEnded;
  }

  setHeader(name: string, value: OutgoingHeaderValue): this {
    // Node throws ERR_HTTP_HEADERS_SENT here; the status line is already on its way.
    if (this.headersSent) return this;
    this.headerMap.set(name.toLowerCase(), Array.isArray(value) ? value.map(String) : String(value));
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headerMap.get(name.toLowerCase());
  }

  getHeaders(): Record<string, string | string[]> {
    return Object.fromEntries(this.headerMap);
  }

  getHeaderNames(): string[] {
    return [...this.headerMap.keys()];
  }

  hasHeader(name: string): boolean {
    return this.headerMap.has(name.toLowerCase());
  }

  removeHeader(name: string): void {
    if (!this.headersSent) this.headerMap.delete(name.toLowerCase());
  }

  writeHead(statusCode: number, reasonOrHeaders?: string | OutgoingHeaders, maybeHeaders?: OutgoingHeaders): this {
    if (this.headersSent) return this;
    this.statusCode = statusCode;
    let headers: OutgoingHeaders | undefined;
    if (typeof reasonOrHeaders === 'string') {
      this.statusMessage = reasonOrHeaders;
      headers = maybeHeaders;
    } else {
      headers = reasonOrHeaders;
    }
    if (isFlatHeaderList(headers)) {
      for (let i = 0; i + 1 < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    } else if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) this.setHeader(name, value);
      }
    }
    this.sendHead();
    return this;
  }

  flushHeaders(): void {
    this.sendHead();
  }

  /** Express `res.status()`. */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /** Express `res.json()`. */
  json(body: unknown): this {
    if (!this.hasHeader('content-type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.end(JSON.stringify(body));
  }

  /** Express `res.send()`. */
  send(body?: unknown): this {
    if (body === undefined || body === null) return this.end();
    if (typeof body === 'string') {
      if (!this.hasHeader('content-type')) this.setHeader('Content-Type', 'text/html; charset=utf-8');
      return this.end(body);
    }
    if (body instanceof Uint8Array) {
      if (!this.hasHeader('content-type')) this.setHeader('Content-Type', 'application/octet-stream');
      return this.end(body);
    }
    return this.json(body);
  }

  /** Express `res.redirect()`. */
  redirect(statusOrUrl: number | string, maybeUrl?: string): this {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
    const location = typeof statusOrUrl === 'string' ? statusOrUrl : (maybeUrl ?? '/');
    this.statusCode = status;
    this.setHeader('Location', location);
    return this.end();
  }

  write(chunk: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean {
    const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    if (!this.writable) return false;
    this.sendHead();
    const encoded = encodeRelayChunk(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);
    if (encoded) this.sink.data(encoded);
    if (typeof cb === 'function') (cb as () => void)();
    return true;
  }

  end(chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown): this {
    let data = chunk;
    let encoding = encodingOrCallback;
    let cb = callback;
    if (typeof data === 'function') {
      cb = data;
      data = undefined;
      encoding = undefined;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    if (this.writableEnded || this.destroyed) {
      if (typeof cb === 'function') (cb as () => void)();
      return this;
    }
    this.sendHead();
    const encoded = encodeRelayChunk(data, typeof encoding === 'string' ? encoding : undefined);
    if (encoded) this.sink.data(encoded);
    this.writableEnded = true;
    this.sink.end();
    this.writableFinished = true;
    this.emit('finish');
    this.emit('close');
    if (typeof cb === 'function') (cb as () => void)();
    return this;
  }

  /**
   * Abort the response: nothing more reaches the sink. `close` fires with the response
   * unfinished, which is how the MCP transports learn the client went away.
   */
  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (error && this.listenerCount('error') > 0) this.emit('error', error);
    if (!this.writableFinished) this.emit('close');
    return this;
  }

  /** Node `ServerResponse` no-ops. */
  cork(): void {
    // no buffering to control
  }

  uncork(): void {
    // no buffering to control
  }

  setTimeout(): this {
    return this;
  }

  /** The response, typed as the `ServerResponse` the flows expect. */
  asServerResponse(): ServerResponse {
    return this as unknown as ServerResponse;
  }

  private sendHead(): void {
    if (this.headersSent || this.destroyed) return;
    this.headersSent = true;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of this.headerMap) {
      if (!HOP_BY_HOP_HEADERS.has(name)) headers[name] = value;
    }
    this.sink.head(this.statusCode, headers);
  }
}

function isFlatHeaderList(headers: OutgoingHeaders | undefined): headers is readonly string[] {
  return Array.isArray(headers);
}
