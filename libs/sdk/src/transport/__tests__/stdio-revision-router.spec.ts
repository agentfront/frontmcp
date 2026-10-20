import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  MCP_20260728_META,
  PROTOCOL_2026_07_28,
  type JSONRPCErrorResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResultResponse,
  type Transport,
} from '@frontmcp/protocol';

import { App, LogLevel, Resource, ResourceContext, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { StdioRevisionRouter } from '../stdio-revision-router';

const NOTE_URI = 'notes://today';
const TASKS_EXTENSION = { extensions: { 'io.modelcontextprotocol/tasks': {} } };

const cancellation = {
  started: undefined as (() => void) | undefined,
  aborted: false,
};

@Tool({ name: 'add', inputSchema: { a: z.number(), b: z.number() } })
class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return { sum: input.a + input.b };
  }
}

@Tool({ name: 'confirm', inputSchema: { action: z.string() } })
class ConfirmTool extends ToolContext {
  async execute(input: { action: string }) {
    const answer = await this.elicit(`Proceed with ${input.action}?`, z.object({ confirmed: z.boolean() }));
    return { confirmed: answer.status === 'accept' && answer.content?.confirmed === true };
  }
}

@Tool({ name: 'chatty', inputSchema: {} })
class ChattyTool extends ToolContext {
  async execute() {
    await this.notify('halfway', 'info');
    await this.progress(1, 2);
    return { done: true };
  }
}

@Tool({ name: 'wait_for_cancel', inputSchema: {} })
class WaitForCancelTool extends ToolContext {
  async execute() {
    const signal = this.signal;
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve(), { once: true });
      cancellation.started?.();
    });
    cancellation.aborted = signal?.aborted === true;
    return { cancelled: cancellation.aborted };
  }
}

@Tool({ name: 'report', inputSchema: {}, execution: { taskSupport: 'optional' } })
class ReportTool extends ToolContext {
  async execute() {
    return { report: 'ready' };
  }
}

@Tool({ name: 'edit_note', inputSchema: {} })
class EditNoteTool extends ToolContext {
  async execute() {
    this.notifyResourceUpdated(NOTE_URI);
    return { saved: true };
  }
}

@Resource({ name: 'today-note', uri: NOTE_URI, mimeType: 'text/plain' })
class TodayNoteResource extends ResourceContext {
  async execute() {
    return 'buy milk';
  }
}

@App({
  id: 'router',
  name: 'Router',
  tools: [AddTool, ConfirmTool, ChattyTool, WaitForCancelTool, ReportTool, EditNoteTool],
  resources: [TodayNoteResource],
})
class RouterApp {}

class FakeStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
  readonly written: JSONRPCMessage[] = [];
  failWrites = false;
  private readonly waiters = new Set<() => void>();

  start = jest.fn(async () => undefined);

  close = jest.fn(async () => {
    this.onclose?.();
  });

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.failWrites) throw new Error('stdout closed');
    this.written.push(message);
    for (const wake of this.waiters) wake();
  }

  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  async waitFor(match: (message: JSONRPCMessage) => boolean): Promise<JSONRPCMessage> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const found = this.written.find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no matching message in ${JSON.stringify(this.written)}`);
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 50);
      });
    }
  }

  reply(id: string | number): Promise<ResponseMessage> {
    return this.waitFor((message) => isResponse(message) && message.id === id) as Promise<ResponseMessage>;
  }
}

interface ResponseMessage {
  jsonrpc: '2.0';
  id: string | number;
  result?: Record<string, unknown> & { _meta?: Record<string, unknown> };
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

function isResponse(message: JSONRPCMessage): message is JSONRPCResultResponse | JSONRPCErrorResponse {
  return isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message);
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

let nextId = 1;

function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
): JSONRPCRequest {
  return {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params: {
      ...params,
      _meta: {
        [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
        [MCP_20260728_META.clientInfo]: { name: 'router-spec', version: '1.0.0' },
        [MCP_20260728_META.clientCapabilities]: {},
        ...meta,
      },
    },
  };
}

function unversionedRequest(method: string, params: Record<string, unknown> = {}): JSONRPCRequest {
  return { jsonrpc: '2.0', id: nextId++, method, params };
}

async function createScope(config: Partial<FrontMcpConfigInput> = {}): Promise<Scope> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'stdio-router', version: '1.0.0' },
    apps: [RouterApp],
    logging: { level: LogLevel.Off },
    elicitation: { enabled: true },
    tasks: { enabled: true, defaultTtlMs: 60_000, defaultPollIntervalMs: 20 },
    ...config,
  } as FrontMcpConfigInput);
  const scope = instance.getScopes()[0] as Scope | undefined;
  if (!scope) throw new Error('the config produced no scope');
  return scope;
}

async function connect(scope: Scope, principal = 'stdio:spec') {
  const stdio = new FakeStdioTransport();
  const router = new StdioRevisionRouter(stdio, { scope, principal });
  const legacy = jest.fn();
  router.onmessage = legacy;
  await router.start();
  return { stdio, router, legacy };
}

describe('StdioRevisionRouter', () => {
  let scope: Scope;

  beforeAll(async () => {
    scope = await createScope();
  });

  describe('2026-07-28 messages', () => {
    it('answers server/discover with every supported revision', async () => {
      const { stdio, legacy } = await connect(scope);
      const request = modernRequest('server/discover');

      stdio.receive(request);
      const { result } = await stdio.reply(request.id);

      expect(result?.['supportedVersions']).toEqual([
        '2026-07-28',
        '2025-11-25',
        '2025-06-18',
        '2025-03-26',
        '2024-11-05',
      ]);
      expect(result?.['resultType']).toBe('complete');
      expect(legacy).not.toHaveBeenCalled();
    });

    it('answers server/discover sent without _meta, a method only 2026-07-28 has', async () => {
      const { stdio } = await connect(scope);
      const request = unversionedRequest('server/discover');

      stdio.receive(request);
      const { result } = await stdio.reply(request.id);

      expect(result?.['supportedVersions']).toContain('2026-07-28');
    });

    it('serves tools/call without the mirrored HTTP headers, with resultType and serverInfo', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest('tools/call', { name: 'add', arguments: { a: 2, b: 3 } });

      stdio.receive(request);
      const { result, error } = await stdio.reply(request.id);

      expect(error).toBeUndefined();
      expect(result?.['resultType']).toBe('complete');
      expect(result?.['structuredContent']).toEqual({ sum: 5 });
      expect(result?._meta?.[MCP_20260728_META.serverInfo]).toEqual({ name: 'stdio-router', version: '1.0.0' });
    });

    it('lists tools in name order with the cache hints', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest('tools/list');

      stdio.receive(request);
      const { result } = await stdio.reply(request.id);
      const names = (result?.['tools'] as Array<{ name: string }>).map((tool) => tool.name);

      expect(names).toEqual([...names].sort());
      expect(names).toContain('add');
      expect(result?.['ttlMs']).toEqual(expect.any(Number));
      expect(['public', 'private']).toContain(result?.['cacheScope']);
    });

    it('reads a resource, and answers an unknown one with -32602', async () => {
      const { stdio } = await connect(scope);
      const read = modernRequest('resources/read', { uri: NOTE_URI });
      const missing = modernRequest('resources/read', { uri: 'notes://missing' });

      stdio.receive(read);
      stdio.receive(missing);

      expect((await stdio.reply(read.id)).result?.['contents']).toEqual([
        expect.objectContaining({ uri: NOTE_URI, text: 'buy milk' }),
      ]);
      expect((await stdio.reply(missing.id)).error?.code).toBe(-32602);
    });

    it('refuses an unsupported revision with -32022 and the supported list', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest('tools/list', {}, { [MCP_20260728_META.protocolVersion]: '1900-01-01' });

      stdio.receive(request);
      const { error } = await stdio.reply(request.id);

      expect(error?.code).toBe(-32022);
      expect(error?.data?.['supported']).toContain('2026-07-28');
      expect(error?.data?.['requested']).toBe('1900-01-01');
    });

    it('refuses a removed method with -32601', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest('ping');

      stdio.receive(request);
      const { error } = await stdio.reply(request.id);

      expect(error?.code).toBe(-32601);
    });

    it('answers -32021 when a tool elicits from a client without the elicitation capability', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest('tools/call', { name: 'confirm', arguments: { action: 'deploy' } });

      stdio.receive(request);
      const { error } = await stdio.reply(request.id);

      expect(error?.code).toBe(-32021);
      expect(error?.data?.['requiredCapabilities']).toEqual({ elicitation: { form: {} } });
    });

    it('asks for input with input_required, and completes the retry that answers it', async () => {
      const { stdio } = await connect(scope);
      const capabilities = { [MCP_20260728_META.clientCapabilities]: { elicitation: { form: {} } } };
      const params = { name: 'confirm', arguments: { action: 'deploy' } };
      const first = modernRequest('tools/call', params, capabilities);

      stdio.receive(first);
      const interim = (await stdio.reply(first.id)).result ?? {};
      expect(interim['resultType']).toBe('input_required');
      const [key] = Object.keys(interim['inputRequests'] as Record<string, unknown>);

      const retry = modernRequest(
        'tools/call',
        {
          ...params,
          inputResponses: { [key]: { action: 'accept', content: { confirmed: true } } },
          requestState: interim['requestState'],
        },
        capabilities,
      );
      stdio.receive(retry);
      const { result } = await stdio.reply(retry.id);

      expect(result?.['resultType']).toBe('complete');
      expect(result?.['structuredContent']).toEqual({ confirmed: true });
    });

    it('writes the log and progress notifications a request asked for before its result', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest(
        'tools/call',
        { name: 'chatty', arguments: {} },
        { [MCP_20260728_META.logLevel]: 'info', progressToken: 'tok-1' },
      );

      stdio.receive(request);
      await stdio.reply(request.id);

      expect(stdio.written.map((message) => ('method' in message ? message.method : 'response'))).toEqual([
        'notifications/message',
        'notifications/progress',
        'response',
      ]);
      expect(stdio.written[1]).toMatchObject({ params: { progressToken: 'tok-1', progress: 1, total: 2 } });
    });

    it('writes no notification for a request that asked for none', async () => {
      const { stdio } = await connect(scope);
      const request = modernRequest('tools/call', { name: 'chatty', arguments: {} });

      stdio.receive(request);
      await stdio.reply(request.id);

      expect(stdio.written).toHaveLength(1);
    });

    it('runs a 2026-07-28 notification through the flow and writes nothing', async () => {
      const { stdio, legacy } = await connect(scope);
      const notification = {
        jsonrpc: '2.0' as const,
        method: 'notifications/initialized',
        params: modernRequest('x').params,
      };

      stdio.receive(notification);
      await settle();

      expect(stdio.written).toEqual([]);
      expect(legacy).not.toHaveBeenCalled();
    });
  });

  describe('cancellation', () => {
    it('aborts a cancelled request and writes nothing more for it', async () => {
      const { stdio, legacy } = await connect(scope);
      const started = new Promise<void>((resolve) => {
        cancellation.started = resolve;
      });
      const request = modernRequest('tools/call', { name: 'wait_for_cancel', arguments: {} });

      stdio.receive(request);
      await started;
      stdio.receive({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: request.id } });
      await settle();

      expect(cancellation.aborted).toBe(true);
      expect(stdio.written).toEqual([]);
      expect(legacy).not.toHaveBeenCalled();
    });

    it('passes the cancellation of a request it is not serving to the session-era server', async () => {
      const { stdio, legacy } = await connect(scope);
      const cancelled = { jsonrpc: '2.0' as const, method: 'notifications/cancelled', params: { requestId: 'other' } };
      const malformed = { jsonrpc: '2.0' as const, method: 'notifications/cancelled', params: { requestId: {} } };

      stdio.receive(cancelled);
      stdio.receive(malformed);

      expect(legacy).toHaveBeenNthCalledWith(1, cancelled, undefined);
      expect(legacy).toHaveBeenNthCalledWith(2, malformed, undefined);
    });

    it('aborts every request in flight when the connection closes', async () => {
      const { stdio, router } = await connect(scope);
      const closed = jest.fn();
      router.onclose = closed;
      const started = new Promise<void>((resolve) => {
        cancellation.started = resolve;
      });
      cancellation.aborted = false;

      stdio.receive(modernRequest('tools/call', { name: 'wait_for_cancel', arguments: {} }));
      await started;
      await router.close();
      await settle();

      expect(cancellation.aborted).toBe(true);
      expect(stdio.close).toHaveBeenCalled();
      expect(closed).toHaveBeenCalled();
    });
  });

  describe('subscriptions/listen', () => {
    it('acknowledges, tags each notification with the subscription id, and stops when cancelled', async () => {
      const { stdio } = await connect(scope);
      const listen = modernRequest('subscriptions/listen', { notifications: { resourceSubscriptions: [NOTE_URI] } });

      stdio.receive(listen);
      const acknowledged = await stdio.waitFor(
        (message) => 'method' in message && message.method === 'notifications/subscriptions/acknowledged',
      );
      expect(acknowledged).toMatchObject({
        params: {
          notifications: { resourceSubscriptions: [NOTE_URI] },
          _meta: { [MCP_20260728_META.subscriptionId]: listen.id },
        },
      });

      const edit = modernRequest('tools/call', { name: 'edit_note', arguments: {} });
      stdio.receive(edit);
      const updated = await stdio.waitFor(
        (message) => 'method' in message && message.method === 'notifications/resources/updated',
      );
      expect(updated).toMatchObject({
        params: { uri: NOTE_URI, _meta: { [MCP_20260728_META.subscriptionId]: listen.id } },
      });
      await stdio.reply(edit.id);

      stdio.receive({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: listen.id } });
      await settle();
      const writtenBefore = stdio.written.length;
      const second = modernRequest('tools/call', { name: 'edit_note', arguments: {} });
      stdio.receive(second);
      await stdio.reply(second.id);

      expect(stdio.written).toHaveLength(writtenBefore + 1);
      expect(stdio.written.some((message) => isResponse(message) && message.id === listen.id)).toBe(false);
    });

    it('writes nothing for a listen cancelled before its stream opens, and releases its listener', async () => {
      const releases: jest.Mock[] = [];
      const subscribe = scope.resources.subscribe.bind(scope.resources);
      const subscribeSpy = jest.spyOn(scope.resources, 'subscribe').mockImplementation((options, callback) => {
        const release = jest.fn(subscribe(options, callback));
        releases.push(release);
        return release;
      });
      const { stdio } = await connect(scope);
      const listen = modernRequest('subscriptions/listen', { notifications: { resourceSubscriptions: [NOTE_URI] } });

      try {
        stdio.receive(listen);
        stdio.receive({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: listen.id } });
        await settle();
      } finally {
        subscribeSpy.mockRestore();
      }

      expect(releases).toHaveLength(1);
      expect(releases[0]).toHaveBeenCalledTimes(1);
      expect(stdio.written).toEqual([]);
    });
  });

  describe('tasks extension', () => {
    it('lets the connection that created a task read it, and no other connection', async () => {
      const { stdio } = await connect(scope, 'stdio:owner');
      const capabilities = { [MCP_20260728_META.clientCapabilities]: TASKS_EXTENSION };
      const call = modernRequest('tools/call', { name: 'report', arguments: {} }, capabilities);

      stdio.receive(call);
      const created = (await stdio.reply(call.id)).result ?? {};
      expect(created['resultType']).toBe('task');
      const taskId = (created['task'] as { taskId: string }).taskId;

      const get = modernRequest('tasks/get', { taskId }, capabilities);
      stdio.receive(get);
      expect((await stdio.reply(get.id)).result?.['taskId']).toBe(taskId);

      const other = await connect(scope, 'stdio:other');
      const foreign = modernRequest('tasks/get', { taskId }, capabilities);
      other.stdio.receive(foreign);
      expect((await other.stdio.reply(foreign.id)).error?.code).toBe(-32602);
    });
  });

  describe('session-era messages', () => {
    it('passes initialize, an unversioned request and a client response to the session-era server', async () => {
      const { stdio, legacy } = await connect(scope);
      const initialize = unversionedRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1.0.0' },
      });
      const call = unversionedRequest('tools/call', { name: 'add', arguments: { a: 1, b: 1 } });
      const clientResponse = { jsonrpc: '2.0' as const, id: 'server-request-1', result: {} };

      stdio.receive(initialize);
      stdio.receive(call);
      stdio.receive(clientResponse);

      expect(legacy.mock.calls.map(([message]) => message)).toEqual([initialize, call, clientResponse]);
      expect(stdio.written).toEqual([]);
    });

    it('writes what the session-era server sends', async () => {
      const { stdio, router } = await connect(scope);
      const notification = { jsonrpc: '2.0' as const, method: 'notifications/tools/list_changed' };

      await router.send(notification);

      expect(stdio.written).toEqual([notification]);
    });

    it('holds back session broadcasts from a connection that opened with 2026-07-28', async () => {
      const { stdio, router } = await connect(scope);
      const discover = modernRequest('server/discover');
      stdio.receive(discover);
      await stdio.reply(discover.id);
      const response = { jsonrpc: '2.0' as const, id: 'legacy-1', result: {} };

      await router.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      await router.send(response);

      expect(stdio.written.slice(1)).toEqual([response]);
    });

    it('serves a 2026-07-28 request on a connection that opened with initialize', async () => {
      const { stdio, router, legacy } = await connect(scope);
      stdio.receive(unversionedRequest('initialize', { protocolVersion: '2025-11-25', capabilities: {} }));
      const request = modernRequest('tools/call', { name: 'add', arguments: { a: 4, b: 4 } });

      stdio.receive(request);
      const { result } = await stdio.reply(request.id);
      await router.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });

      expect(result?.['structuredContent']).toEqual({ sum: 8 });
      expect(legacy).toHaveBeenCalledTimes(1);
      expect(stdio.written.at(-1)).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    });
  });

  describe('transport.defaultProtocolVersion', () => {
    let statelessScope: Scope;

    beforeAll(async () => {
      statelessScope = await createScope({ transport: { defaultProtocolVersion: '2026-07-28' } });
    });

    it('serves an unversioned request as 2026-07-28 when set to 2026-07-28', async () => {
      const { stdio, legacy } = await connect(statelessScope);
      const request = unversionedRequest('tools/call', { name: 'add', arguments: { a: 1, b: 2 } });

      stdio.receive(request);
      const { result } = await stdio.reply(request.id);

      expect(result?.['resultType']).toBe('complete');
      expect(legacy).not.toHaveBeenCalled();
    });

    it('keeps unversioned requests in the session once the connection sent initialize', async () => {
      const { stdio, legacy } = await connect(statelessScope);
      const initialize = unversionedRequest('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
      const call = unversionedRequest('tools/call', { name: 'add', arguments: { a: 1, b: 2 } });

      stdio.receive(initialize);
      stdio.receive(call);

      expect(legacy.mock.calls.map(([message]) => message)).toEqual([initialize, call]);
    });
  });

  describe('failures', () => {
    it('answers a request the flow failed with -32603', async () => {
      const { stdio } = await connect(scope);
      const runFlow = jest.spyOn(scope, 'runFlow').mockRejectedValueOnce(new Error('boom'));
      const request = modernRequest('tools/list');

      stdio.receive(request);
      const { error } = await stdio.reply(request.id);
      runFlow.mockRestore();

      expect(error).toEqual({ code: -32603, message: 'Internal error' });
    });

    it('answers -32603 when the flow streams a body it cannot read', async () => {
      const { stdio } = await connect(scope);
      const runFlow = jest
        .spyOn(scope, 'runFlow')
        .mockResolvedValueOnce({ kind: 'sse', status: 200, stream: { pipe: () => undefined } } as never);
      const request = modernRequest('tools/list');

      stdio.receive(request);
      const { error } = await stdio.reply(request.id);
      runFlow.mockRestore();

      expect(error?.code).toBe(-32603);
    });

    it('logs a reply it could not write', async () => {
      const { stdio } = await connect(scope);
      const logged = jest.fn();
      const logger = scope.logger;
      const childOf = logger.child.bind(logger);
      const child = jest
        .spyOn(logger, 'child')
        .mockImplementation((name) => (name === 'StdioRevisionRouter' ? ({ error: logged } as never) : childOf(name)));
      stdio.failWrites = true;

      stdio.receive(modernRequest('tools/list'));
      await settle();
      child.mockRestore();

      expect(logged).toHaveBeenCalledWith('failed to serve a 2026-07-28 message', {
        method: 'tools/list',
        error: 'stdout closed',
      });
    });

    it('forwards an error of the stdio transport', async () => {
      const { stdio, router } = await connect(scope);
      const onerror = jest.fn();
      router.onerror = onerror;
      const error = new Error('parse failure');

      stdio.onerror?.(error);

      expect(onerror).toHaveBeenCalledWith(error);
    });
  });
});
