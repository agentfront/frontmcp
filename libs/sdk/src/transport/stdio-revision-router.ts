import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type JSONRPCNotification,
  type JSONRPCRequest,
  type RequestId,
  type Transport,
} from '@frontmcp/protocol';

import { ServerRequestTokens, type HttpOutput, type HttpReadableLike, type StdioRequestOrigin } from '../common';
import { type Scope } from '../scope';
import { flowErrorToHttpOutput } from './flow-error-output';
import { isProtocol20260728Request } from './mcp-20260728';

type SendOptions = Parameters<Transport['send']>[1];
type MessageExtra = Parameters<NonNullable<Transport['onmessage']>>[1];

export interface StdioRevisionRouterOptions {
  scope: Scope;
  /** Names the connection; it owns the tasks its 2026-07-28 requests create. */
  principal: string;
}

const EVENT_SEPARATOR = '\n\n';
const EVENT_DATA_FIELD = 'data:';

function eventData(event: string): string {
  return event
    .split('\n')
    .filter((line) => line.startsWith(EVENT_DATA_FIELD))
    .map((line) => line.slice(EVENT_DATA_FIELD.length).trimStart())
    .join('\n');
}

async function* eventStreamMessages(stream: AsyncIterable<Uint8Array>): AsyncGenerator<JSONRPCMessage> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let boundary = pending.indexOf(EVENT_SEPARATOR);
    while (boundary !== -1) {
      const data = eventData(pending.slice(0, boundary));
      pending = pending.slice(boundary + EVENT_SEPARATOR.length);
      if (data) yield JSON.parse(data) as JSONRPCMessage;
      boundary = pending.indexOf(EVENT_SEPARATOR);
    }
  }
}

function isAsyncIterable(stream: HttpReadableLike): stream is AsyncIterable<Uint8Array> {
  return Symbol.asyncIterator in stream;
}

function internalError(id: RequestId): JSONRPCMessage {
  return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } };
}

/** Runs MCP 2026-07-28 messages through `handle:mcp-202607280728`, and passes the rest to the session-era server. */
export class StdioRevisionRouter implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];

  private readonly inFlight = new Map<RequestId, AbortController>();

  /** `initialize` makes the connection session-era for good; a 2026-07-28 message first makes it stateless. */
  private era: 'unknown' | 'legacy' | 'modern' = 'unknown';

  constructor(
    private readonly inner: Transport,
    private readonly options: StdioRevisionRouterOptions,
  ) {}

  async start(): Promise<void> {
    this.inner.onmessage = (message, extra) => this.route(message, extra);
    this.inner.onerror = (error) => this.onerror?.(error);
    this.inner.onclose = () => {
      this.cancelAll();
      this.onclose?.();
    };
    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: SendOptions): Promise<void> {
    // A stateless client has no session, so it gets no session broadcasts (list changes, channel events).
    if (this.era === 'modern' && isJSONRPCNotification(message)) return;
    await this.inner.send(message, options);
  }

  async close(): Promise<void> {
    this.cancelAll();
    await this.inner.close();
  }

  private route(message: JSONRPCMessage, extra?: MessageExtra): void {
    if (this.cancelsModernRequest(message)) return;

    if ((isJSONRPCRequest(message) || isJSONRPCNotification(message)) && this.servesModern(message)) {
      if (this.era === 'unknown') this.era = 'modern';
      void this.serveModern(message);
      return;
    }

    if (isJSONRPCRequest(message) && message.method === 'initialize') this.era = 'legacy';
    this.onmessage?.(message, extra);
  }

  private servesModern(message: JSONRPCRequest | JSONRPCNotification): boolean {
    const configured = this.options.scope.metadata.transport?.defaultProtocolVersion ?? 'legacy';
    return isProtocol20260728Request({
      headers: undefined,
      body: message,
      defaultVersion: this.era === 'legacy' ? 'legacy' : configured,
    });
  }

  private cancelsModernRequest(message: JSONRPCMessage): boolean {
    if (!isJSONRPCNotification(message) || message.method !== 'notifications/cancelled') return false;

    const requestId = message.params?.['requestId'];
    if (typeof requestId !== 'string' && typeof requestId !== 'number') return false;

    const controller = this.inFlight.get(requestId);
    if (!controller) return false;

    this.inFlight.delete(requestId);
    controller.abort();
    return true;
  }

  private async serveModern(message: JSONRPCRequest | JSONRPCNotification): Promise<void> {
    const id = isJSONRPCRequest(message) ? message.id : undefined;
    const controller = new AbortController();
    if (id !== undefined) this.inFlight.set(id, controller);

    try {
      const output = await this.runFlow(message, controller.signal);
      if (id !== undefined) await this.reply(output, id, controller.signal);
    } catch (error) {
      this.options.scope.logger.child('StdioRevisionRouter').error('failed to serve a 2026-07-28 message', {
        method: message.method,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (id !== undefined && this.inFlight.get(id) === controller) this.inFlight.delete(id);
    }
  }

  private async runFlow(
    message: JSONRPCRequest | JSONRPCNotification,
    signal: AbortSignal,
  ): Promise<HttpOutput | undefined> {
    const origin: StdioRequestOrigin = { principal: this.options.principal, signal };
    const request = {
      method: 'POST',
      path: '/',
      url: '/',
      headers: {},
      query: {},
      body: message,
      [ServerRequestTokens.stdio]: origin,
    };
    try {
      return await this.options.scope.runFlow('handle:mcp-202607280728', { request, response: {} });
    } catch (error) {
      return flowErrorToHttpOutput(error);
    }
  }

  private async reply(output: HttpOutput | undefined, id: RequestId, signal: AbortSignal): Promise<void> {
    if (output?.kind === 'sse' && isAsyncIterable(output.stream)) {
      for await (const message of eventStreamMessages(output.stream)) {
        if (signal.aborted) return;
        await this.inner.send(message);
      }
      return;
    }

    if (signal.aborted) return;
    const body = output?.kind === 'json' ? output.body : undefined;
    const isReply = isJSONRPCResultResponse(body) || isJSONRPCErrorResponse(body);
    await this.inner.send(isReply ? body : internalError(id));
  }

  private cancelAll(): void {
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }
}
