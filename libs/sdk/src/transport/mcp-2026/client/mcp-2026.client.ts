/**
 * MCP client for protocol revision 2026-07-28.
 *
 * The upstream `@modelcontextprotocol/sdk` client speaks at most `2025-11-25`,
 * so talking to a 2026 server needs its own implementation. It is small on
 * purpose — the revision is stateless, so there is no session, no handshake and
 * no reconnect logic to manage. What it DOES own is the three behaviours a
 * conforming client must implement:
 *
 * - **Request metadata.** Per-request `_meta` plus the mirrored
 *   `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` headers.
 * - **MRTR.** An `input_required` result is answered by gathering the requested
 *   input and re-issuing the ORIGINAL request — with a NEW JSON-RPC id and the
 *   `requestState` echoed back verbatim.
 * - **Tasks.** A `resultType: "task"` handle is polled through `tasks/get`
 *   until it reaches a terminal state, answering `input_required` along the way
 *   via `tasks/update`.
 *
 * @module transport/mcp-2026/client
 */
import { MCP_2026_META, PROTOCOL_2026_07_28, type Implementation } from '@frontmcp/protocol';

import { encodeHeaderValue } from '../header-codec';
import { NAME_FROM_PARAMS_NAME, NAME_FROM_PARAMS_URI } from '../protocol-2026.constants';
import { TASKS_EXTENSION_ID, TERMINAL_TASK_STATUSES } from '../tasks-extension';
import { buildParamHeaders, validateHeaderParams } from './header-params';

/** Answers the client supplies when a server asks for input via MRTR. */
export interface Mcp2026InputHandlers {
  /** Handle an `elicitation/create` request. */
  onElicit?: (params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Handle a `sampling/createMessage` request. */
  onSample?: (params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Handle a `roots/list` request. */
  onListRoots?: () =>
    | Promise<{ roots: Array<{ uri: string; name?: string }> }>
    | { roots: Array<{ uri: string; name?: string }> };
}

export interface Mcp2026ClientOptions {
  /** The MCP endpoint URL. */
  url: string;
  clientInfo?: Implementation;
  /** Capabilities declared on EVERY request (they are per-request in this revision). */
  capabilities?: Record<string, unknown>;
  /** Extra headers (e.g. `Authorization`) sent with every request. */
  headers?: Record<string, string>;
  /** Log level to opt into; omit to receive no `notifications/message`. */
  logLevel?: string;
  /** Called for every notification received on a response stream. */
  onNotification?: (notification: { method: string; params?: Record<string, unknown> }) => void;
  /** How the client answers MRTR input requests. */
  handlers?: Mcp2026InputHandlers;
  /** Maximum MRTR round trips before giving up, guarding against a server that never settles. */
  maxInputRounds?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export class Mcp2026Error extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'Mcp2026Error';
  }
}

interface JsonRpcResponse {
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

const DEFAULT_CLIENT_INFO: Implementation = { name: 'frontmcp-2026-client', version: '1.0.0' };

export class Mcp2026Client {
  private nextId = 1;
  private readonly options: Required<Pick<Mcp2026ClientOptions, 'url' | 'maxInputRounds'>> & Mcp2026ClientOptions;
  /** Cached tool input schemas, needed to derive `Mcp-Param-*` headers. */
  private toolSchemas = new Map<string, unknown>();

  constructor(options: Mcp2026ClientOptions) {
    this.options = { maxInputRounds: 8, ...options };
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  /** Ask the server which versions, capabilities and identity it offers. */
  async discover(): Promise<Record<string, unknown>> {
    return this.request('server/discover');
  }

  /**
   * List tools, dropping any whose `x-mcp-header` annotations are invalid.
   *
   * The spec requires this: one malformed tool definition must not prevent the
   * other tools from being used, so the offender is excluded and logged rather
   * than failing the call.
   */
  async listTools(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request('tools/list');
    const tools = Array.isArray(result['tools']) ? (result['tools'] as Array<Record<string, unknown>>) : [];

    const usable: Array<Record<string, unknown>> = [];
    for (const tool of tools) {
      const validation = validateHeaderParams(tool['inputSchema']);
      if (!validation.valid) {
        this.warn(`Rejecting tool "${String(tool['name'])}": ${validation.reason}`);
        continue;
      }
      this.toolSchemas.set(String(tool['name']), tool['inputSchema']);
      usable.push(tool);
    }
    return usable;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.request('tools/call', { name, arguments: args });
  }

  async readResource(uri: string): Promise<Record<string, unknown>> {
    return this.request('resources/read', { uri });
  }

  async listResources(): Promise<Record<string, unknown>> {
    return this.request('resources/list');
  }

  async listPrompts(): Promise<Record<string, unknown>> {
    return this.request('prompts/list');
  }

  async getPrompt(name: string, args: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return this.request('prompts/get', { name, arguments: args });
  }

  /**
   * Issue a request, resolving MRTR round trips and task handles transparently.
   *
   * The caller sees a single promise for the FINAL result, which is the whole
   * point of centralising this: every entry point would otherwise need its own
   * retry loop.
   */
  async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let carriedState: string | undefined;
    let inputResponses: Record<string, Record<string, unknown>> | undefined;

    for (let round = 0; round <= this.options.maxInputRounds; round++) {
      const attemptParams: Record<string, unknown> = { ...params };
      if (inputResponses) attemptParams['inputResponses'] = inputResponses;
      // MUST be echoed back verbatim, and MUST be omitted when the server sent none.
      if (carriedState !== undefined) attemptParams['requestState'] = carriedState;

      const result = await this.send(method, attemptParams);

      const resultType = result['resultType'];

      if (resultType === 'task') {
        return this.awaitTask(result['task'] as Record<string, unknown>);
      }

      if (resultType !== 'input_required') return result;

      const requests =
        (result['inputRequests'] as Record<string, { method: string; params?: Record<string, unknown> }>) ?? {};
      inputResponses = await this.gatherInputs(requests);
      carriedState = typeof result['requestState'] === 'string' ? (result['requestState'] as string) : undefined;
    }

    throw new Mcp2026Error(-32603, `Server kept requesting input after ${this.options.maxInputRounds} rounds`);
  }

  /** Fulfil each `inputRequests` entry using the configured handlers. */
  private async gatherInputs(
    requests: Record<string, { method: string; params?: Record<string, unknown> }>,
  ): Promise<Record<string, Record<string, unknown>>> {
    const answers: Record<string, Record<string, unknown>> = {};

    for (const [key, request] of Object.entries(requests)) {
      const handlers = this.options.handlers ?? {};
      switch (request.method) {
        case 'elicitation/create': {
          if (!handlers.onElicit)
            throw new Mcp2026Error(-32603, 'Server requested elicitation but no handler is configured');
          answers[key] = await handlers.onElicit(request.params ?? {});
          break;
        }
        case 'sampling/createMessage': {
          if (!handlers.onSample)
            throw new Mcp2026Error(-32603, 'Server requested sampling but no handler is configured');
          answers[key] = await handlers.onSample(request.params ?? {});
          break;
        }
        case 'roots/list': {
          if (!handlers.onListRoots)
            throw new Mcp2026Error(-32603, 'Server requested roots but no handler is configured');
          answers[key] = (await handlers.onListRoots()) as unknown as Record<string, unknown>;
          break;
        }
        default:
          throw new Mcp2026Error(-32603, `Unsupported input request: ${request.method}`);
      }
    }

    return answers;
  }

  /**
   * Poll a task handle to a terminal state, answering mid-flight input requests.
   *
   * Honours the server's `pollIntervalMs` hint rather than picking our own
   * cadence — the server knows how long its work takes.
   */
  private async awaitTask(task: Record<string, unknown>): Promise<Record<string, unknown>> {
    const taskId = String(task['taskId']);
    const interval = typeof task['pollIntervalMs'] === 'number' ? (task['pollIntervalMs'] as number) : 250;
    const ttl = typeof task['ttlMs'] === 'number' ? (task['ttlMs'] as number) : 60_000;
    const deadline = Date.now() + ttl;

    let current = task;
    while (Date.now() < deadline) {
      const status = String(current['status']);

      if (status === 'completed') return (current['result'] as Record<string, unknown>) ?? {};
      if (status === 'failed') {
        const error = current['error'] as { code?: number; message?: string } | undefined;
        throw new Mcp2026Error(error?.code ?? -32603, error?.message ?? 'Task failed');
      }
      if (status === 'cancelled') throw new Mcp2026Error(-32603, `Task ${taskId} was cancelled`);

      if (status === 'input_required') {
        const requests =
          (current['inputRequests'] as Record<string, { method: string; params?: Record<string, unknown> }>) ?? {};
        const answers = await this.gatherInputs(requests);
        await this.send('tasks/update', { taskId, inputResponses: answers });
      } else {
        await new Promise((resolve) => setTimeout(resolve, interval));
      }

      current = await this.send('tasks/get', { taskId });
    }

    throw new Mcp2026Error(-32603, `Task ${taskId} did not settle within ${ttl}ms`);
  }

  /** Cancel a running task. */
  async cancelTask(taskId: string): Promise<void> {
    await this.send('tasks/cancel', { taskId });
  }

  /**
   * Open a `subscriptions/listen` stream.
   *
   * Resolves once the server acknowledges the subscription, so callers know
   * which notification types were actually honoured before they start waiting
   * on them.
   */
  async listen(
    notifications: Record<string, unknown>,
    onNotification: (notification: { method: string; params?: Record<string, unknown> }) => void,
  ): Promise<{ acknowledged: Record<string, unknown>; close: () => void }> {
    const id = this.nextId++;
    const { body, headers } = this.buildRequest('subscriptions/listen', { notifications }, id);
    const controller = new AbortController();

    const response = await this.fetchImpl(this.options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Mcp2026Error(-32603, `subscriptions/listen failed with HTTP ${response.status}`);
    }

    let resolveAck: ((value: Record<string, unknown>) => void) | undefined;
    const acknowledged = new Promise<Record<string, unknown>>((resolve) => {
      resolveAck = resolve;
    });

    void this.pumpSse(response.body, (message) => {
      if (message['method'] === 'notifications/subscriptions/acknowledged') {
        const params = message['params'] as Record<string, unknown> | undefined;
        resolveAck?.((params?.['notifications'] as Record<string, unknown>) ?? {});
        return;
      }
      if (message['method']) onNotification(message as { method: string; params?: Record<string, unknown> });
    }).catch(() => {
      // Stream aborted by close() — expected.
    });

    return { acknowledged: await acknowledged, close: () => controller.abort() };
  }

  /** Build and issue one JSON-RPC request, returning its result. */
  private async send(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Each retry MUST use a NEW id — the spec treats the retry as an
    // independent request, not a continuation.
    const id = this.nextId++;
    const { body, headers } = this.buildRequest(method, params, id);

    const response = await this.fetchImpl(this.options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const payload = await this.readResponse(response);

    if (payload.error) {
      throw new Mcp2026Error(payload.error.code, payload.error.message, payload.error.data);
    }
    return payload.result ?? {};
  }

  /** Assemble the JSON-RPC body and its mirrored HTTP headers. */
  private buildRequest(
    method: string,
    params: Record<string, unknown>,
    id: number,
  ): { body: Record<string, unknown>; headers: Record<string, string> } {
    const meta: Record<string, unknown> = {
      [MCP_2026_META.protocolVersion]: PROTOCOL_2026_07_28,
      [MCP_2026_META.clientInfo]: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      [MCP_2026_META.clientCapabilities]: this.options.capabilities ?? {},
    };
    if (this.options.logLevel) meta[MCP_2026_META.logLevel] = this.options.logLevel;

    const body = { jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_2026_07_28,
      'Mcp-Method': method,
      ...(this.options.headers ?? {}),
    };

    const name = this.deriveName(method, params);
    if (name !== undefined) headers['Mcp-Name'] = encodeHeaderValue(name);

    if (method === 'tools/call' && typeof params['name'] === 'string') {
      Object.assign(
        headers,
        buildParamHeaders(this.toolSchemas.get(params['name'] as string), params['arguments'], encodeHeaderValue),
      );
    }

    return { body, headers };
  }

  private deriveName(method: string, params: Record<string, unknown>): string | undefined {
    if (NAME_FROM_PARAMS_NAME.includes(method) && typeof params['name'] === 'string') return params['name'] as string;
    if (NAME_FROM_PARAMS_URI.includes(method) && typeof params['uri'] === 'string') return params['uri'] as string;
    return undefined;
  }

  /**
   * Read either framing the server may choose.
   *
   * A JSON body is the response outright; an SSE body carries this request's
   * notifications followed by the final response, so notifications are forwarded
   * as they arrive and the terminating message is returned.
   */
  private async readResponse(response: Response): Promise<JsonRpcResponse> {
    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('text/event-stream')) {
      const text = await response.text();
      if (!text.trim()) return {};
      return JSON.parse(text) as JsonRpcResponse;
    }

    let final: JsonRpcResponse | undefined;
    if (response.body) {
      await this.pumpSse(response.body, (message) => {
        if (message['method']) {
          this.options.onNotification?.(message as { method: string; params?: Record<string, unknown> });
          return;
        }
        final = message as JsonRpcResponse;
      });
    }
    return final ?? {};
  }

  /** Drain an SSE body, handing each decoded JSON message to `onMessage`. */
  private async pumpSse(
    body: ReadableStream<Uint8Array>,
    onMessage: (message: Record<string, any>) => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator: number;
      while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, '');

        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n');
        if (!data) continue;

        try {
          onMessage(JSON.parse(data) as Record<string, unknown>);
        } catch {
          // A malformed frame is skipped rather than killing the stream — SSE
          // comments and keep-alives legitimately carry no JSON.
        }
      }
    }
  }

  private warn(message: string): void {
    console.warn(`[Mcp2026Client] ${message}`);
  }
}

/** Convenience: the capability object a client declaring the tasks extension sends. */
export const TASKS_CLIENT_CAPABILITY = { extensions: { [TASKS_EXTENSION_ID]: {} } };

/** Re-exported so callers can check task terminality without importing the extension module. */
export { TERMINAL_TASK_STATUSES };
