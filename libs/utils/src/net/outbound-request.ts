/** SSRF-hardened HTTP for a URL a client chose: validated addresses only, no redirects, bounded time and sizes. */

import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';

import { isEdgeRuntime } from '#env';

import { isNode } from '../crypto/runtime';
import { isAllowedOutboundAddress, validateOutboundUrl, type OutboundTargetOptions } from './outbound-url';

export const OUTBOUND_TIMEOUT_MS = 10_000;
export const OUTBOUND_MAX_REQUEST_BYTES = 262_144;

export interface OutboundRequest extends OutboundTargetOptions {
  url: string;
  /** @default 'POST' with a body, 'GET' without */
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Sent as these exact UTF-8 bytes. */
  body?: string;
  /** Cancels the request, which then ends as a timeout. */
  signal?: AbortSignal;
  /** @default OUTBOUND_TIMEOUT_MS */
  timeoutMs?: number;
  /** @default OUTBOUND_MAX_REQUEST_BYTES */
  maxRequestBytes?: number;
  /** How many bytes of the answer's body to read. @default 0 */
  maxResponseBytes?: number;
  /** The answer's headers to return, by name. @default none */
  responseHeaders?: readonly string[];
}

export interface OutboundAnswer {
  answered: true;
  /** A redirect is not followed: its 3xx status is returned, or 0 where a browser hides it. */
  status: number;
  /** The first `maxResponseBytes` of the body, as UTF-8 text. */
  body: string;
  /** Whether the body was longer than `maxResponseBytes`; false when that is 0, as the body is then not read. */
  bodyTruncated: boolean;
  /** The headers named in `responseHeaders` that the answer carries, by lowercase name. */
  headers: Record<string, string>;
}

export type OutboundFailureReason =
  | 'invalid_url'
  | 'forbidden_address'
  | 'unresolved_host'
  | 'request_too_large'
  | 'connection_refused'
  | 'timeout'
  | 'tls_error';

export interface OutboundFailure {
  answered: false;
  reason: OutboundFailureReason;
}

export type OutboundResult = OutboundAnswer | OutboundFailure;

export type OutboundFailureCategory = 'connection_refused' | 'timeout' | 'tls_error' | 'http_4xx' | 'http_5xx';

const FAILURE_CATEGORIES: Record<OutboundFailureReason, OutboundFailureCategory> = {
  invalid_url: 'connection_refused',
  forbidden_address: 'connection_refused',
  unresolved_host: 'connection_refused',
  request_too_large: 'http_4xx',
  connection_refused: 'connection_refused',
  timeout: 'timeout',
  tls_error: 'tls_error',
};

const TIMEOUT_CODE_PATTERN = /TIMEDOUT|TIMEOUT/;
const TLS_CODE_PATTERN =
  /CERT|TLS|SSL|CRL|EPROTO|^UNABLE_TO_|^INVALID_(?:CA|PURPOSE)$|^PATH_LENGTH_EXCEEDED$|^HOSTNAME_MISMATCH$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface NodeNetworking {
  dns: typeof import('node:dns');
  http: typeof import('node:http');
  https: typeof import('node:https');
}

interface Exchange {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: ReturnType<TextEncoder['encode']>;
  signal: AbortSignal;
}

interface Upstream {
  status: number;
  headerOf(name: string): string | undefined;
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  discard(): unknown;
}

class OutboundRefusal extends Error {
  constructor(readonly reason: OutboundFailureReason) {
    super(reason);
  }
}

/** The fixed category of a result that is not a 2xx answer: all that the party who chose the URL may be told. */
export function outboundFailureCategory(result: OutboundResult): OutboundFailureCategory | undefined {
  if (!result.answered) return FAILURE_CATEGORIES[result.reason];
  if (result.status >= 200 && result.status < 300) return undefined;
  return result.status >= 500 ? 'http_5xx' : 'http_4xx';
}

/** Sends the request; on a runtime without Node's `dns` and `net` (browser, edge) the platform resolves DNS. */
export async function sendOutboundRequest(request: OutboundRequest): Promise<OutboundResult> {
  const check = validateOutboundUrl(request.url, request);
  if (!check.ok) return { answered: false, reason: check.problem === 'host' ? 'forbidden_address' : 'invalid_url' };

  const body = request.body === undefined ? undefined : encoder.encode(request.body);
  if (body && body.byteLength > (request.maxRequestBytes ?? OUTBOUND_MAX_REQUEST_BYTES)) {
    return { answered: false, reason: 'request_too_large' };
  }

  const timeout = AbortSignal.timeout(request.timeoutMs ?? OUTBOUND_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const headers: Record<string, string> = { ...request.headers };
  if (body) headers['content-length'] = String(body.byteLength);
  const method = request.method ?? (body ? 'POST' : 'GET');
  const exchange: Exchange = { url: check.url, method, headers, body, signal };
  try {
    const node = loadNodeNetworking();
    const upstream = node ? await exchangeOverNode(node, exchange, request) : await exchangeOverFetch(exchange);
    return await answerOf(upstream, request);
  } catch (error) {
    return { answered: false, reason: failureReasonOf(error, signal) };
  }
}

/** Node's `dns`, `http` and `https`, or nothing on a runtime without them. */
function loadNodeNetworking(): NodeNetworking | undefined {
  if (!isNode() || isEdgeRuntime()) return undefined;
  return { dns: require('node:dns'), http: require('node:http'), https: require('node:https') };
}

/** A promise that rejects when the signal aborts, to bound a lookup that cannot be cancelled. */
function rejectedOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** Resolves the host once and returns its addresses only when every one of them may be requested. */
async function resolveAllowedAddresses(
  node: NodeNetworking,
  exchange: Exchange,
  options: OutboundTargetOptions,
): Promise<LookupAddress[]> {
  exchange.signal.throwIfAborted();
  const hostname = exchange.url.hostname.replace(/^\[|\]$/g, '');
  let addresses: LookupAddress[];
  try {
    const lookup = node.dns.promises.lookup(hostname, { all: true });
    addresses = await Promise.race([lookup, rejectedOnAbort(exchange.signal)]);
  } catch (error) {
    throw exchange.signal.aborted ? error : new OutboundRefusal('unresolved_host');
  }
  if (addresses.length === 0) throw new OutboundRefusal('unresolved_host');
  if (!addresses.every(({ address }) => isAllowedOutboundAddress(address, options))) {
    throw new OutboundRefusal('forbidden_address');
  }
  return addresses;
}

/** A `lookup` that answers with the checked addresses only, so the connection cannot go anywhere else. */
function pinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [...addresses]);
      return;
    }
    const [first] = addresses;
    callback(null, first.address, first.family);
  };
}

/** Sends the request over Node sockets pinned to the checked addresses. */
async function exchangeOverNode(
  node: NodeNetworking,
  exchange: Exchange,
  options: OutboundTargetOptions,
): Promise<Upstream> {
  const { url, method, headers, body, signal } = exchange;
  const lookup = pinnedLookup(await resolveAllowedAddresses(node, exchange, options));
  const transport = url.protocol === 'https:' ? node.https : node.http;
  const incoming = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = transport.request(url, { method, headers, signal, lookup, agent: false }, resolve);
    outgoing.on('error', reject);
    outgoing.end(body);
  });
  return {
    status: Number(incoming.statusCode),
    headerOf: (name) => {
      const value = incoming.headers[name];
      return value === undefined ? undefined : String(value);
    },
    chunks: incoming,
    discard: () => incoming.destroy(),
  };
}

/** The chunks of a web stream, cancelling it when the reader stops early. */
async function* chunksOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel();
  }
}

/** Sends the request through `fetch` where the platform resolves DNS; a redirect is not followed. */
async function exchangeOverFetch(exchange: Exchange): Promise<Upstream> {
  const { url, method, headers, body, signal } = exchange;
  const response = await fetch(url, { method, headers, body, redirect: 'manual', signal });
  return {
    status: response.status,
    headerOf: (name) => response.headers.get(name) ?? undefined,
    chunks: response.body ? chunksOf(response.body) : [],
    discard: () => response.body?.cancel(),
  };
}

/** Reads at most `maxBytes` of the answer and says whether more was there. */
async function readBody(upstream: Upstream, maxBytes: number): Promise<Pick<OutboundAnswer, 'body' | 'bodyTruncated'>> {
  if (maxBytes <= 0) {
    await upstream.discard();
    return { body: '', bodyTruncated: false };
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of upstream.chunks) {
    chunks.push(chunk);
    received += chunk.byteLength;
    if (received > maxBytes) break;
  }
  const bytes = new Uint8Array(Math.min(received, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.subarray(0, bytes.byteLength - offset), offset);
    offset += chunk.byteLength;
  }
  return { body: decoder.decode(bytes), bodyTruncated: received > maxBytes };
}

/** The result of an answered request: status, requested headers and the bounded body. */
async function answerOf(upstream: Upstream, request: OutboundRequest): Promise<OutboundAnswer> {
  const headers: Record<string, string> = {};
  for (const requestedName of request.responseHeaders ?? []) {
    const name = requestedName.toLowerCase();
    const value = upstream.headerOf(name);
    if (value !== undefined) headers[name] = value;
  }
  const { body, bodyTruncated } = await readBody(upstream, request.maxResponseBytes ?? 0);
  return { answered: true, status: upstream.status, body, bodyTruncated, headers };
}

/** The fixed reason of a failed request, from the refusal, the abort or the socket error code. */
function failureReasonOf(error: unknown, signal: AbortSignal): OutboundFailureReason {
  if (error instanceof OutboundRefusal) return error.reason;
  if (signal.aborted) return 'timeout';
  const { code, cause } = Object(error) as { code?: unknown; cause?: unknown };
  const errorCode = String(code ?? (Object(cause) as { code?: unknown }).code);
  if (TIMEOUT_CODE_PATTERN.test(errorCode)) return 'timeout';
  return TLS_CODE_PATTERN.test(errorCode) ? 'tls_error' : 'connection_refused';
}
