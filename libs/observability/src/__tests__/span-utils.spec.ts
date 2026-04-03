import { SpanKind, SpanStatusCode, context as otelContext, type Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { startSpan, endSpanOk, endSpanError, withSpan } from '../otel/spans/span.utils';
import { startHttpServerSpan, setHttpResponseStatus } from '../otel/spans/http-server.span';
import { startRpcSpan } from '../otel/spans/rpc.span';
import { startToolSpan } from '../otel/spans/tool.span';
import { startResourceSpan } from '../otel/spans/resource.span';
import { startPromptSpan } from '../otel/spans/prompt.span';
import { recordHookEvent, startHookSpan } from '../otel/spans/hook.span';
import { startFetchSpan, setFetchResponseStatus } from '../otel/spans/fetch.span';
import { FrontMcpAttributes, HttpAttributes, RpcAttributes } from '../otel/otel.types';

describe('Span Utilities', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let tracer: Tracer;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    // Get tracer directly from provider, not from global trace API
    tracer = provider.getTracer('test');
  });

  afterEach(async () => {
    exporter.reset();
    await provider.forceFlush();
    await provider.shutdown();
  });

  describe('startSpan / endSpanOk / endSpanError', () => {
    it('should create and end a span with OK status', () => {
      const { span } = startSpan(tracer, { name: 'test-op' });
      endSpanOk(span);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('test-op');
      expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    });

    it('should create and end a span with ERROR status', () => {
      const { span } = startSpan(tracer, { name: 'fail-op' });
      endSpanError(span, new Error('something broke'));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
      expect(spans[0].status.message).toBe('something broke');
      expect(spans[0].events).toHaveLength(1); // recordException
    });

    it('should handle string error messages', () => {
      const { span } = startSpan(tracer, { name: 'fail-op' });
      endSpanError(span, 'string error');

      const spans = exporter.getFinishedSpans();
      expect(spans[0].status.message).toBe('string error');
    });

    it('should set span kind', () => {
      const { span } = startSpan(tracer, { name: 'server-op', kind: SpanKind.SERVER });
      endSpanOk(span);

      expect(exporter.getFinishedSpans()[0].kind).toBe(SpanKind.SERVER);
    });

    it('should set attributes', () => {
      const { span } = startSpan(tracer, {
        name: 'test',
        attributes: { key1: 'value1', key2: 42 },
      });
      endSpanOk(span);

      const attrs = exporter.getFinishedSpans()[0].attributes;
      expect(attrs['key1']).toBe('value1');
      expect(attrs['key2']).toBe(42);
    });
  });

  describe('withSpan', () => {
    it('should wrap execution and end span on success', async () => {
      const result = await withSpan(tracer, { name: 'wrapped' }, async () => {
        return 'ok';
      });

      expect(result).toBe('ok');
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    });

    it('should end span with error on throw', async () => {
      await expect(
        withSpan(tracer, { name: 'fail' }, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    });
  });

  describe('HTTP Server Span', () => {
    it('should create span with correct HTTP attributes', () => {
      const { span } = startHttpServerSpan(tracer, {
        method: 'POST',
        path: '/mcp',
        scheme: 'https',
        scopeId: 'my-app',
        requestId: 'req-123',
      });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('POST /mcp');
      expect(exported.kind).toBe(SpanKind.SERVER);
      expect(exported.attributes[HttpAttributes.METHOD]).toBe('POST');
      expect(exported.attributes[HttpAttributes.URL_PATH]).toBe('/mcp');
      expect(exported.attributes[HttpAttributes.URL_SCHEME]).toBe('https');
      expect(exported.attributes[FrontMcpAttributes.SCOPE_ID]).toBe('my-app');
      expect(exported.attributes[FrontMcpAttributes.REQUEST_ID]).toBe('req-123');
    });

    it('should set response status code', () => {
      const { span } = startHttpServerSpan(tracer, { method: 'GET', path: '/' });
      setHttpResponseStatus(span, 200);
      endSpanOk(span);

      expect(exporter.getFinishedSpans()[0].attributes[HttpAttributes.STATUS_CODE]).toBe(200);
    });

    it('should handle optional fields', () => {
      const { span } = startHttpServerSpan(tracer, { method: 'get', path: '/test' });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('GET /test');
      expect(exported.attributes[HttpAttributes.URL_SCHEME]).toBeUndefined();
      expect(exported.attributes[FrontMcpAttributes.SCOPE_ID]).toBeUndefined();
    });

    it('should set server address and port when provided', () => {
      const { span } = startHttpServerSpan(tracer, {
        method: 'POST',
        path: '/mcp',
        serverAddress: 'localhost',
        serverPort: 3000,
      });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.attributes[HttpAttributes.SERVER_ADDRESS]).toBe('localhost');
      expect(exported.attributes[HttpAttributes.SERVER_PORT]).toBe(3000);
    });
  });

  describe('RPC Span', () => {
    it('should create span with MCP RPC attributes', () => {
      const { span } = startRpcSpan(tracer, {
        method: 'tools/call',
        requestId: 42,
        scopeId: 'app',
        serviceName: 'my-server',
        sessionIdHash: 'sess123456789abc',
      });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('tools/call');
      expect(exported.attributes[RpcAttributes.SYSTEM]).toBe('mcp');
      expect(exported.attributes[RpcAttributes.METHOD]).toBe('tools/call');
      expect(exported.attributes[RpcAttributes.JSONRPC_VERSION]).toBe('2.0');
      expect(exported.attributes[RpcAttributes.JSONRPC_REQUEST_ID]).toBe('42');
      expect(exported.attributes[RpcAttributes.SERVICE]).toBe('my-server');
      expect(exported.attributes['mcp.method.name']).toBe('tools/call');
      expect(exported.attributes['mcp.session.id']).toBe('sess123456789abc');
      expect(exported.attributes[FrontMcpAttributes.SERVER_NAME]).toBe('my-server');
    });

    it('should handle missing optional fields', () => {
      const { span } = startRpcSpan(tracer, { method: 'resources/read' });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.attributes[RpcAttributes.JSONRPC_REQUEST_ID]).toBeUndefined();
      expect(exported.attributes[FrontMcpAttributes.SCOPE_ID]).toBeUndefined();
      expect(exported.attributes[RpcAttributes.SERVICE]).toBeUndefined();
    });
  });

  describe('Tool Span', () => {
    it('should create span with tool and component attributes', () => {
      const { span } = startToolSpan(tracer, {
        name: 'get_weather',
        owner: 'WeatherTools',
        enduserId: 'client-42',
        enduserScope: 'read write',
      });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('tool get_weather');
      expect(exported.attributes[FrontMcpAttributes.TOOL_NAME]).toBe('get_weather');
      expect(exported.attributes[FrontMcpAttributes.TOOL_OWNER]).toBe('WeatherTools');
      expect(exported.attributes['mcp.component.type']).toBe('tool');
      expect(exported.attributes['mcp.component.key']).toBe('tool:get_weather');
      expect(exported.attributes['enduser.id']).toBe('client-42');
      expect(exported.attributes['enduser.scope']).toBe('read write');
    });

    it('should handle missing owner and enduser', () => {
      const { span } = startToolSpan(tracer, { name: 'test_tool' });
      endSpanOk(span);
      const attrs = exporter.getFinishedSpans()[0].attributes;
      expect(attrs[FrontMcpAttributes.TOOL_OWNER]).toBeUndefined();
      expect(attrs['enduser.id']).toBeUndefined();
      expect(attrs['enduser.scope']).toBeUndefined();
    });
  });

  describe('Resource Span', () => {
    it('should create span with resource and component attributes', () => {
      const { span } = startResourceSpan(tracer, { uri: 'file:///data.txt', name: 'data' });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('resource file:///data.txt');
      expect(exported.attributes[FrontMcpAttributes.RESOURCE_URI]).toBe('file:///data.txt');
      expect(exported.attributes[FrontMcpAttributes.RESOURCE_NAME]).toBe('data');
      expect(exported.attributes['mcp.resource.uri']).toBe('file:///data.txt');
      expect(exported.attributes['mcp.component.type']).toBe('resource');
      expect(exported.attributes['mcp.component.key']).toBe('resource:file:///data.txt');
    });

    it('should handle missing name', () => {
      const { span } = startResourceSpan(tracer, { uri: 'custom://res' });
      endSpanOk(span);
      expect(exporter.getFinishedSpans()[0].attributes[FrontMcpAttributes.RESOURCE_NAME]).toBeUndefined();
    });
  });

  describe('Prompt Span', () => {
    it('should create span with prompt and component attributes', () => {
      const { span } = startPromptSpan(tracer, { name: 'summarize' });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('prompt summarize');
      expect(exported.attributes[FrontMcpAttributes.PROMPT_NAME]).toBe('summarize');
      expect(exported.attributes['mcp.component.type']).toBe('prompt');
      expect(exported.attributes['mcp.component.key']).toBe('prompt:summarize');
    });
  });

  describe('Hook Span', () => {
    it('should record hook event on parent span', () => {
      const { span } = startSpan(tracer, { name: 'parent' });
      recordHookEvent(span, 'willExecute', 'MyTool');
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.events).toHaveLength(1);
      expect(exported.events[0].name).toBe('hook.willExecute');
      expect(exported.events[0].attributes?.[FrontMcpAttributes.HOOK_OWNER]).toBe('MyTool');
    });

    it('should record hook event without owner', () => {
      const { span } = startSpan(tracer, { name: 'parent' });
      recordHookEvent(span, 'didExecute');
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.events[0].name).toBe('hook.didExecute');
    });

    it('should create dedicated hook span when in verbose mode', () => {
      const { span } = startHookSpan(tracer, {
        stage: 'willValidateInput',
        owner: 'ValidationHook',
        flowName: 'tools:call-tool',
      });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('hook willValidateInput');
      expect(exported.attributes[FrontMcpAttributes.HOOK_STAGE]).toBe('willValidateInput');
      expect(exported.attributes[FrontMcpAttributes.HOOK_OWNER]).toBe('ValidationHook');
      expect(exported.attributes[FrontMcpAttributes.FLOW_NAME]).toBe('tools:call-tool');
    });

    it('should create hook span without owner and flowName', () => {
      const { span } = startHookSpan(tracer, { stage: 'onMetrics' });
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('hook onMetrics');
      expect(exported.attributes[FrontMcpAttributes.HOOK_OWNER]).toBeUndefined();
      expect(exported.attributes[FrontMcpAttributes.FLOW_NAME]).toBeUndefined();
    });
  });

  describe('Fetch Span', () => {
    it('should create outbound HTTP client span', () => {
      const { span } = startFetchSpan(tracer, {
        method: 'GET',
        url: 'https://api.example.com/data',
      });
      setFetchResponseStatus(span, 200);
      endSpanOk(span);

      const exported = exporter.getFinishedSpans()[0];
      expect(exported.name).toBe('GET');
      expect(exported.kind).toBe(SpanKind.CLIENT);
      expect(exported.attributes[HttpAttributes.METHOD]).toBe('GET');
      expect(exported.attributes[HttpAttributes.URL_FULL]).toBe('https://api.example.com/data');
      expect(exported.attributes[HttpAttributes.STATUS_CODE]).toBe(200);
    });
  });
});
