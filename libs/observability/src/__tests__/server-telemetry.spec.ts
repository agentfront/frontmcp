/**
 * Spans and request logs of a real server (`createFetchHandler()`): what a failed call records, how the
 * spans of one request nest, the `traceparent` that `this.fetch()` sends, and the tracing and request-log
 * options that used to be accepted without effect.
 */
import 'reflect-metadata';

import { diag, DiagLogLevel, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

import {
  App,
  FrontMcpInstance,
  LogLevel,
  Plugin,
  PublicMcpError,
  Tool,
  ToolContext,
  ToolHook,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '@frontmcp/sdk';

import type { TracingOptions } from '../otel/otel.types';
import ObservabilityPlugin from '../plugin/observability.plugin';
import type { RequestLog } from '../request-log/request-log.types';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
diag.setLogger({ debug() {}, info() {}, warn() {}, error() {}, verbose() {} }, DiagLogLevel.NONE);
trace.setGlobalTracerProvider(provider);

const echoedHeaders: Headers[] = [];
const realFetch = globalThis.fetch;

@Tool({ name: 'close_ticket', inputSchema: {} })
class CloseTicket extends ToolContext {
  async execute() {
    this.fail(new PublicMcpError('no such ticket'));
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class Ping extends ToolContext {
  async execute() {
    await this.fetch('https://echo.test/');
    return 'pong';
  }
}

@Tool({ name: 'export_report', inputSchema: {} })
class ExportReport extends ToolContext {
  async execute() {
    return 'exported';
  }
}

@Plugin({ name: 'audit' })
class AuditPlugin {
  @ToolHook.Did('execute')
  async audit(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    if (flowCtx.state.tool?.metadata.name === 'export_report') throw new Error('audit store password rejected');
  }
}

@App({ id: 'desk', name: 'Desk', tools: [CloseTicket, Ping, ExportReport] })
class DeskApp {}

function toolCall(name: string): Request {
  return new Request('https://desk.example.com/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': name,
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    }),
  });
}

async function serve(tracing: TracingOptions = {}, logs: RequestLog[] = []) {
  return FrontMcpInstance.createFetchHandler({
    info: { name: 'desk', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    plugins: [
      AuditPlugin,
      ObservabilityPlugin.init({ tracing, requestLogs: { onRequestComplete: (log) => void logs.push(log) } }),
    ],
  } as FrontMcpConfigInput);
}

const span = (name: string): ReadableSpan => {
  const found = exporter.getFinishedSpans().find((each) => each.name === name);
  if (!found) throw new Error(`no span ${name} in ${exporter.getFinishedSpans().map((each) => each.name)}`);
  return found;
};
const parentOf = (child: ReadableSpan) => child.parentSpanContext?.spanId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeAll(() => {
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://echo.test/')) return realFetch(input, init);
    echoedHeaders.push(new Request(input, init).headers);
    return new Response('ok');
  };
});

afterEach(() => {
  exporter.reset();
  echoedHeaders.length = 0;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await provider.shutdown();
});

describe('a call that this.fail() ended', () => {
  it('ends the tool and tools/call spans with the error the client sees, and logs it', async () => {
    const logs: RequestLog[] = [];
    const handler = await serve({}, logs);

    await handler(toolCall('close_ticket'));
    await settle();

    for (const name of ['tool close_ticket', 'tools/call']) {
      expect(span(name).status).toEqual({ code: SpanStatusCode.ERROR, message: 'no such ticket' });
      expect(span(name).events.find((event) => event.name === 'exception')?.attributes).toEqual(
        expect.objectContaining({ 'exception.type': 'PUBLIC_ERROR', 'exception.message': 'no such ticket' }),
      );
    }
    expect(logs[0].error).toEqual(
      expect.objectContaining({ type: 'PublicMcpError', message: 'no such ticket', code: 'PUBLIC_ERROR' }),
    );
  });
});

describe('a call that a hook failed with a plain Error', () => {
  it('records the masked message and the error ID the client gets, not the raw message', async () => {
    const logs: RequestLog[] = [];
    const handler = await serve({}, logs);

    const { result } = await (await handler(toolCall('export_report'))).json();
    await settle();

    const errorId = result._meta.errorId;
    const message = `Internal FrontMCP error. Please contact support with error ID: ${errorId}`;
    expect(span('tools/call').status).toEqual({ code: SpanStatusCode.ERROR, message });
    expect(logs[0].error).toEqual({ type: 'GenericServerError', message, code: 'SERVER_ERROR', error_id: errorId });
  });
});

describe('the spans of one request', () => {
  it('nests the tools/call span in the POST / span, and this.fetch() sends the GET span as the parent', async () => {
    const handler = await serve();

    await handler(toolCall('ping'));

    expect(parentOf(span('tools/call'))).toBe(span('POST /').spanContext().spanId);
    const get = span('GET').spanContext();
    expect(echoedHeaders[0].get('traceparent')).toBe(`00-${get.traceId}-${get.spanId}-01`);
  });

  it('leaves out stage events with flowStageEvents: false', async () => {
    const handler = await serve({ flowStageEvents: false });

    await handler(toolCall('ping'));

    const stageEvents = exporter
      .getFinishedSpans()
      .flatMap((each) => each.events.filter((e) => e.name.startsWith('stage.')));
    expect(stageEvents).toEqual([]);
  });

  it('gives each other hook a span inside its flow span with hookSpans: true', async () => {
    const handler = await serve({ hookSpans: true });

    await handler(toolCall('ping'));

    const hook = span('hook didExecute');
    expect(hook.attributes).toEqual(expect.objectContaining({ 'frontmcp.hook.owner': 'AuditPlugin' }));
    expect(parentOf(hook)).toBe(span('tools/call').spanContext().spanId);
    expect(exporter.getFinishedSpans().filter((each) => each.name.startsWith('hook '))).toHaveLength(1);
  });
});

describe('request logs', () => {
  it('logs the status code, how the caller authenticated and the hooks that ran', async () => {
    const logs: RequestLog[] = [];
    const handler = await serve({}, logs);

    await handler(toolCall('ping'));
    await settle();

    expect(logs[0]).toEqual(
      expect.objectContaining({
        status: 'ok',
        status_code: 200,
        auth_type: 'anonymous',
        authenticated: false,
        hooks_triggered: ['tools:call-tool:didExecute'],
      }),
    );
  });
});

describe('startupReport', () => {
  it('emits a frontmcp.startup span with what the server registered once it is ready', async () => {
    await serve();

    expect(span('frontmcp.startup').attributes).toEqual(
      expect.objectContaining({ 'frontmcp.startup.tools_count': 3, 'frontmcp.startup.plugins_count': 2 }),
    );
  });

  it('emits none with startupReport: false', async () => {
    await serve({ startupReport: false });

    expect(exporter.getFinishedSpans().map((each) => each.name)).not.toContain('frontmcp.startup');
  });
});

describe('oauthSpans and elicitationSpans', () => {
  function flowContext() {
    const request = {
      requestId: 'req-1',
      sessionId: 'session-1',
      scopeId: 'root',
      traceContext: { traceId: 'a'.repeat(32), parentId: 'b'.repeat(16), traceFlags: 1, raw: '' },
    };
    return { get: (token: unknown) => (token === Symbol.for('frontmcp:CONTEXT') ? request : undefined), state: {} };
  }

  function spansOf(tracing: TracingOptions): string[] {
    const plugin = new ObservabilityPlugin({ tracing });
    const oauth = flowContext();
    plugin._oauthTokenWill(oauth);
    plugin._oauthTokenDone(oauth);
    const elicitation = flowContext();
    plugin._elicitReqWill(elicitation);
    plugin._elicitReqDone(elicitation);
    return exporter.getFinishedSpans().map((each) => each.name);
  }

  it('records the OAuth and elicitation flow spans by default', () => {
    expect(spansOf({})).toEqual(['oauth/token', 'elicitation/request']);
  });

  it('leaves them out when turned off', () => {
    expect(spansOf({ oauthSpans: false, elicitationSpans: false })).toEqual([]);
  });
});
