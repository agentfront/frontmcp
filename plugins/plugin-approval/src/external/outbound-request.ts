/**
 * The one way the plugin calls an external approval system: a JSON POST with a timeout, no redirects followed and a
 * bounded answer.
 *
 * @module @frontmcp/plugin-approval
 */

import { isRedirectResponse } from '@frontmcp/utils';

/** How long the plugin waits for an approval system to answer one request. */
export const OUTBOUND_TIMEOUT_MS = 10_000;

/** The largest answer the plugin reads from an approval system, in bytes. */
export const OUTBOUND_MAX_RESPONSE_BYTES = 64 * 1024;

/** A request that got no usable answer. Its message names no URL, header or body, so it can be logged. */
export class OutboundRequestError extends Error {
  override readonly name = 'OutboundRequestError';
}

export interface OutboundRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  /** Cancels the request, as the tool call that made it is cancelled. */
  signal?: AbortSignal;
  /** @default OUTBOUND_TIMEOUT_MS */
  timeoutMs?: number;
}

export interface OutboundAnswer {
  status: number;
  body: string;
}

async function readBounded(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > OUTBOUND_MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new OutboundRequestError(`answered with more than ${OUTBOUND_MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > OUTBOUND_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OutboundRequestError(`answered with more than ${OUTBOUND_MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function failureCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  return typeof cause?.code === 'string' ? cause.code : error instanceof Error ? error.name : 'unknown error';
}

/** POSTs `body` as JSON and returns the answer, or throws {@link OutboundRequestError}. */
export async function postJson(request: OutboundRequest): Promise<OutboundAnswer> {
  const timeoutMs = request.timeoutMs ?? OUTBOUND_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cancel = () => controller.abort();
  request.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { ...request.headers, 'content-type': 'application/json', accept: 'application/json' },
      body: request.body,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (isRedirectResponse(response)) {
      await response.body?.cancel();
      throw new OutboundRequestError(`answered with a redirect (${response.status}), which is not followed`);
    }
    return { status: response.status, body: await readBounded(response) };
  } catch (error) {
    if (error instanceof OutboundRequestError) throw error;
    if (request.signal?.aborted) throw new OutboundRequestError('the tool call was cancelled');
    if (controller.signal.aborted) throw new OutboundRequestError(`no answer within ${timeoutMs} ms`);
    throw new OutboundRequestError(`the request failed (${failureCode(error)})`);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', cancel);
  }
}

/** The origin of a URL, which is all a log line names of it. */
export function originOf(url: string): string {
  return new URL(url).origin;
}
