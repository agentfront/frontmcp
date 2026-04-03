/**
 * Integration tests for FrontMCP Observability.
 *
 * Tests the FULL pipeline across all component types:
 * - Logger → StructuredLogTransport → Sinks (with trace correlation)
 * - Hooks → OTel Spans (for tools, resources, prompts, agents, etc.)
 * - TelemetryAccessor → child spans + events on parent span
 * - OtlpSink → OTLP payload format
 *
 * Simulates how observability works from the perspective of:
 * - Official plugins (cache-like hook pattern)
 * - Official adapters (OpenAPI-generated tools)
 * - External plugins / custom tools
 * - Resources, Prompts, Agents
 * - Flows (HTTP, transport, auth)
 * - Jobs/workflows (via tool execution)
 */

import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, SpanStatusCode, diag, DiagLogLevel } from '@opentelemetry/api';

import { StructuredLogTransport, type ContextSnapshot } from '../logging/structured-log-transport';
import type { StructuredLogEntry } from '../logging/structured-log.types';
import { CallbackSink } from '../logging/sinks/callback.sink';
import { TelemetryAccessor } from '../telemetry/telemetry.accessor';
import { ACTIVE_SPAN_KEY, ACTIVE_OTEL_CTX_KEY } from '../plugin/observability.hooks';

import {
  onToolWillParse,
  onToolWillExecute,
  onToolDidExecute,
  onToolDidFinalize,
  onResourceWillParse,
  onResourceWillExecute,
  onResourceDidExecute,
  onResourceDidFinalize,
  onPromptWillParse,
  onPromptWillExecute,
  onPromptDidExecute,
  onPromptDidFinalize,
  onAgentWillParse,
  onAgentWillExecute,
  onAgentDidExecute,
  onAgentDidFinalize,
  onHttpWillTrace,
  onHttpDidFinalize,
  onTransportWillStart,
  onTransportDidRoute,
  onTransportDidFinalize,
  onAuthWillStart,
  onAuthDidFinalize,
  onGenericFlowWillStart,
  onGenericFlowDidFinalize,
  SPAN_KEY,
} from '../plugin/observability.hooks';

import type { TracingOptions } from '../otel/otel.types';

// ─── Global OTel test setup ────────────────────────────────────────────────
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
diag.setLogger(
  { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, verbose: () => {} },
  DiagLogLevel.NONE,
);
provider.register();
afterAll(async () => {
  await provider.shutdown();
});

const TRACE_OPTS: TracingOptions = {
  httpSpans: true,
  executionSpans: true,
  hookSpans: false,
  fetchSpans: true,
  flowStageEvents: true,
  transportSpans: true,
  authSpans: true,
  oauthSpans: true,
  elicitationSpans: true,
  startupReport: true,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const TRACE_ID = 'abcdef1234567890abcdef1234567890';
const PARENT_ID = '1234567890abcdef';

function makeFlowCtx(overrides?: Record<string, unknown>) {
  const store = new Map<string | symbol, unknown>();
  return {
    state: {
      input: { name: 'test_tool', uri: 'file:///data.txt', arguments: {} },
      _toolOwnerId: 'TestOwner',
      ...overrides,
    } as Record<string | symbol, unknown>,
    get: (token: unknown) => {
      if (token === Symbol.for('frontmcp:CONTEXT')) {
        return {
          requestId: 'req-integration-001',
          sessionId: 'integration-session',
          scopeId: 'integration-scope',
          traceContext: {
            traceId: TRACE_ID,
            parentId: PARENT_ID,
            traceFlags: 1,
            raw: `00-${TRACE_ID}-${PARENT_ID}-01`,
          },
          authInfo: { clientId: 'client-42', scopes: ['read', 'write', 'admin'] },
          metadata: { customHeaders: { 'x-http-method': 'POST', 'x-url-path': '/mcp' } },
          set: (key: string | symbol, val: unknown) => store.set(key, val),
          get: <T>(key: string | symbol) => store.get(key) as T,
          delete: (key: string | symbol) => store.delete(key),
          flow: { name: 'tools:call-tool' },
          elapsed: () => 42,
        };
      }
      return undefined;
    },
  };
}

function makeLogRecord(msg: string, args: unknown[] = []) {
  return {
    level: 2, // Info
    levelName: 'info',
    message: msg,
    args,
    timestamp: new Date(),
    prefix: 'TestModule',
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Integration: Logger → StructuredLogTransport → Sinks', () => {
  it('should enrich log records with trace context', () => {
    const entries: StructuredLogEntry[] = [];
    const sink = new CallbackSink((e) => entries.push(e));

    const contextAccessor = (): ContextSnapshot => ({
      requestId: 'req-001',
      traceContext: { traceId: TRACE_ID, parentId: PARENT_ID, traceFlags: 1 },
      sessionIdHash: 'sesshash12345678',
      scopeId: 'my-scope',
      flowName: 'tools:call-tool',
      elapsed: 55,
    });

    const transport = new StructuredLogTransport([sink], {}, contextAccessor);
    transport.log(makeLogRecord('processing user request', [{ userId: 123 }]));

    expect(entries).toHaveLength(1);
    expect(entries[0].trace_id).toBe(TRACE_ID);
    expect(entries[0].span_id).toBe(PARENT_ID);
    expect(entries[0].request_id).toBe('req-001');
    expect(entries[0].session_id_hash).toBe('sesshash12345678');
    expect(entries[0].scope_id).toBe('my-scope');
    expect(entries[0].flow_name).toBe('tools:call-tool');
    expect(entries[0].elapsed_ms).toBe(55);
    expect(entries[0].message).toBe('processing user request');
    expect(entries[0].attributes).toEqual({ userId: 123 });
  });

  it('should redact sensitive fields', () => {
    const entries: StructuredLogEntry[] = [];
    const sink = new CallbackSink((e) => entries.push(e));
    const transport = new StructuredLogTransport([sink], { redactFields: ['password', 'token'] });

    transport.log(makeLogRecord('auth', [{ user: 'alice', password: 'secret', token: 'abc' }]));

    expect(entries[0].attributes).toEqual({
      user: 'alice',
      password: '[REDACTED]',
      token: '[REDACTED]',
    });
  });

  it('should extract error details from Error args', () => {
    const entries: StructuredLogEntry[] = [];
    const sink = new CallbackSink((e) => entries.push(e));
    const transport = new StructuredLogTransport([sink]);

    const err = new Error('connection refused') as Error & { code: number; errorId: string };
    err.code = -32603;
    err.errorId = 'err-uuid';
    transport.log(makeLogRecord('failed', [err]));

    expect(entries[0].error?.type).toBe('Error');
    expect(entries[0].error?.message).toBe('connection refused');
    expect(entries[0].error?.code).toBe('-32603');
    expect(entries[0].error?.error_id).toBe('err-uuid');
  });
});

describe('Integration: Tool execution observability', () => {
  beforeEach(() => exporter.reset());

  it('should create full span hierarchy: RPC → Tool with stage events', () => {
    const ctx = makeFlowCtx();
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);
    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);

    const spans = exporter.getFinishedSpans();
    const rpcSpan = spans.find((s) => s.name === 'tools/call');
    const toolSpan = spans.find((s) => s.name === 'tool test_tool');

    // Verify spans exist
    expect(rpcSpan).toBeTruthy();
    expect(toolSpan).toBeTruthy();

    // Verify single trace ID
    expect(rpcSpan!.spanContext().traceId).toBe(TRACE_ID);
    expect(toolSpan!.spanContext().traceId).toBe(TRACE_ID);

    // Verify parent-child: tool span is child of RPC span
    expect(toolSpan!.parentSpanId).toBe(rpcSpan!.spanContext().spanId);

    // Verify MCP attributes
    expect(rpcSpan!.attributes['rpc.system']).toBe('mcp');
    expect(rpcSpan!.attributes['mcp.method.name']).toBe('tools/call');
    expect(toolSpan!.attributes['mcp.component.type']).toBe('tool');
    expect(toolSpan!.attributes['mcp.component.key']).toBe('tool:test_tool');
    expect(toolSpan!.attributes['enduser.id']).toBe('client-42');
    expect(toolSpan!.attributes['enduser.scope']).toBe('read write admin');

    // Verify flow stage events on tool span
    const toolEvents = toolSpan!.events.map((e) => e.name);
    expect(toolEvents).toContain('stage.execute.start');
    expect(toolEvents).toContain('stage.execute.done');
  });

  it('should propagate errors to both spans', () => {
    const ctx = makeFlowCtx();
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);
    ctx.state.error = new Error('tool crashed');
    onToolDidFinalize(ctx);

    const rpcSpan = exporter.getFinishedSpans().find((s) => s.name === 'tools/call');
    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool test_tool');
    expect(rpcSpan!.status.code).toBe(SpanStatusCode.ERROR);
    expect(toolSpan!.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('Integration: Resource read observability', () => {
  beforeEach(() => exporter.reset());

  it('should create RPC → Resource spans with correct attributes', () => {
    const ctx = makeFlowCtx();
    onResourceWillParse(TRACE_OPTS, ctx);
    onResourceWillExecute(TRACE_OPTS, ctx);
    onResourceDidExecute(ctx);
    onResourceDidFinalize(ctx);

    const rpcSpan = exporter.getFinishedSpans().find((s) => s.name === 'resources/read');
    const resSpan = exporter.getFinishedSpans().find((s) => s.name.startsWith('resource'));

    expect(rpcSpan!.spanContext().traceId).toBe(TRACE_ID);
    expect(resSpan!.attributes['mcp.component.type']).toBe('resource');
    expect(resSpan!.attributes['mcp.resource.uri']).toBe('file:///data.txt');
  });
});

describe('Integration: Prompt invocation observability', () => {
  beforeEach(() => exporter.reset());

  it('should create RPC → Prompt spans', () => {
    const ctx = makeFlowCtx();
    onPromptWillParse(TRACE_OPTS, ctx);
    onPromptWillExecute(TRACE_OPTS, ctx);
    onPromptDidExecute(ctx);
    onPromptDidFinalize(ctx);

    const promptSpan = exporter.getFinishedSpans().find((s) => s.name.startsWith('prompt'));
    expect(promptSpan!.attributes['mcp.component.type']).toBe('prompt');
    expect(promptSpan!.spanContext().traceId).toBe(TRACE_ID);
  });
});

describe('Integration: Agent execution observability', () => {
  beforeEach(() => exporter.reset());

  it('should create RPC → Agent spans with nested tool calls sharing trace ID', () => {
    const agentCtx = makeFlowCtx({ input: { name: 'research-agent' } });
    onAgentWillParse(TRACE_OPTS, agentCtx);
    onAgentWillExecute(TRACE_OPTS, agentCtx);

    // Simulate nested tool call within agent execution
    // (in reality, agent calls scope.runFlow('tools:call-tool') which triggers tool hooks)
    const toolCtx = makeFlowCtx({ input: { name: 'web_search' } });
    onToolWillParse(TRACE_OPTS, toolCtx);
    onToolWillExecute(TRACE_OPTS, toolCtx);
    onToolDidExecute(TRACE_OPTS, toolCtx);
    onToolDidFinalize(toolCtx);

    onAgentDidExecute(agentCtx);
    onAgentDidFinalize(agentCtx);

    const spans = exporter.getFinishedSpans();
    const agentRpc = spans.find((s) => s.name === 'agents/call');
    const agentSpan = spans.find((s) => s.name === 'agent research-agent');
    const toolRpc = spans.find((s) => s.name === 'tools/call');
    const toolSpan = spans.find((s) => s.name === 'tool web_search');

    // ALL spans share the same trace ID
    for (const span of [agentRpc, agentSpan, toolRpc, toolSpan]) {
      expect(span).toBeTruthy();
      expect(span!.spanContext().traceId).toBe(TRACE_ID);
    }

    expect(agentSpan!.attributes['mcp.component.type']).toBe('agent');
  });
});

describe('Integration: HTTP + Transport + Auth flow', () => {
  beforeEach(() => exporter.reset());

  it('should create HTTP → Transport → Auth spans in same trace', () => {
    const ctx = makeFlowCtx();

    // HTTP request flow
    onHttpWillTrace(TRACE_OPTS, ctx);

    // Transport flow (streamable-http)
    const transportCtx = makeFlowCtx();
    onTransportWillStart('streamable-http', TRACE_OPTS, transportCtx);
    onTransportDidRoute(transportCtx);
    onTransportDidFinalize(transportCtx);

    // Auth flow
    const authCtx = makeFlowCtx();
    onAuthWillStart('auth:verify', TRACE_OPTS, authCtx);
    onAuthDidFinalize(authCtx);

    onHttpDidFinalize(ctx);

    const spans = exporter.getFinishedSpans();
    const httpSpan = spans.find((s) => s.name.includes('/mcp'));
    const transportSpan = spans.find((s) => s.name === 'transport streamable-http');
    const authSpan = spans.find((s) => s.name === 'auth auth:verify');

    expect(httpSpan).toBeTruthy();
    expect(transportSpan).toBeTruthy();
    expect(authSpan).toBeTruthy();

    // All share trace ID
    for (const span of [httpSpan, transportSpan, authSpan]) {
      expect(span!.spanContext().traceId).toBe(TRACE_ID);
    }
  });
});

describe('Integration: Generic flows (skills, lists, OAuth, elicitation)', () => {
  beforeEach(() => exporter.reset());

  const flowNames = [
    'tools/list',
    'resources/list',
    'prompts/list',
    'skills/search',
    'skills/load',
    'oauth/token',
    'oauth/authorize',
    'elicitation/request',
    'elicitation/result',
    'completion/complete',
    'resources/subscribe',
    'resources/unsubscribe',
    'skills-http/llm-txt',
    'well-known/jwks',
    'logging/set-level',
  ];

  for (const flowName of flowNames) {
    it(`should create span for ${flowName}`, () => {
      const ctx = makeFlowCtx();
      onGenericFlowWillStart(flowName, TRACE_OPTS, ctx);
      onGenericFlowDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.name).toBe(flowName);
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(span.attributes['frontmcp.flow.name']).toBe(flowName);
      exporter.reset();
    });
  }
});

describe('Integration: TelemetryAccessor (this.telemetry) in tool context', () => {
  beforeEach(() => exporter.reset());

  it('should add events to active tool span', () => {
    const ctx = makeFlowCtx();

    // Hooks create tool span and store on context
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);

    // Simulate TelemetryAccessor (as a tool would use this.telemetry)
    const frontmcpCtx = ctx.get(Symbol.for('frontmcp:CONTEXT')) as any;
    const accessor = new TelemetryAccessor(frontmcpCtx);

    // These should land ON the tool span
    accessor.addEvent('data-fetched', { rows: 100 });
    accessor.setAttributes({ 'cache.hit': true });

    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool test_tool');
    expect(toolSpan).toBeTruthy();

    // Verify events on the tool span
    const eventNames = toolSpan!.events.map((e) => e.name);
    expect(eventNames).toContain('data-fetched');

    // Verify attributes on the tool span
    expect(toolSpan!.attributes['cache.hit']).toBe(true);
  });

  it('should create child spans under tool span', () => {
    const ctx = makeFlowCtx();
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);

    const frontmcpCtx = ctx.get(Symbol.for('frontmcp:CONTEXT')) as any;
    const accessor = new TelemetryAccessor(frontmcpCtx);

    // Create a child span
    const child = accessor.startSpan('call-external-api');
    child.setAttribute('api.url', 'https://api.example.com');
    child.end();

    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);

    const spans = exporter.getFinishedSpans();
    const toolSpan = spans.find((s) => s.name === 'tool test_tool');
    const childSpan = spans.find((s) => s.name === 'call-external-api');

    expect(childSpan).toBeTruthy();
    expect(childSpan!.spanContext().traceId).toBe(TRACE_ID);
    // Child should be nested under tool span
    expect(childSpan!.parentSpanId).toBe(toolSpan!.spanContext().spanId);
  });

  it('should handle withSpan async wrapper', async () => {
    const ctx = makeFlowCtx();
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);

    const frontmcpCtx = ctx.get(Symbol.for('frontmcp:CONTEXT')) as any;
    const accessor = new TelemetryAccessor(frontmcpCtx);

    const result = await accessor.withSpan('process-data', async (span) => {
      span.addEvent('step-1');
      span.addEvent('step-2');
      return 42;
    });

    expect(result).toBe(42);

    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);

    const processSpan = exporter.getFinishedSpans().find((s) => s.name === 'process-data');
    expect(processSpan).toBeTruthy();
    expect(processSpan!.status.code).toBe(SpanStatusCode.OK);
    expect(processSpan!.events).toHaveLength(2);
  });
});

describe('Integration: Plugin-like hook pattern (external plugins)', () => {
  beforeEach(() => exporter.reset());

  it('should work with plugin hooks that use this.telemetry pattern', () => {
    // Simulates an external plugin (e.g., plugin-cache, plugin-codecall)
    // that uses hooks AND telemetry in the same flow
    const ctx = makeFlowCtx();

    // Auto-instrumentation hooks fire
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);

    // Plugin hook runs DURING tool execution (like cache willReadCache)
    const frontmcpCtx = ctx.get(Symbol.for('frontmcp:CONTEXT')) as any;
    const accessor = new TelemetryAccessor(frontmcpCtx);
    accessor.addEvent('cache.lookup', { key: 'tool:test_tool:hash123' });
    accessor.addEvent('cache.miss');

    onToolDidExecute(TRACE_OPTS, ctx);

    // Plugin hook runs AFTER execution (like cache willWriteCache)
    // Note: active span is cleared after didExecute, so this falls back
    accessor.addEvent('cache.write', { ttl: 3600 });

    onToolDidFinalize(ctx);

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool test_tool');
    const toolEvents = toolSpan!.events.map((e) => e.name);
    expect(toolEvents).toContain('cache.lookup');
    expect(toolEvents).toContain('cache.miss');
  });
});

describe('Integration: Adapter-generated tool observability', () => {
  beforeEach(() => exporter.reset());

  it('should trace OpenAPI adapter-generated tool same as manual tool', () => {
    // OpenAPI adapter generates tools that execute via the same tools:call-tool flow.
    // The observability hooks don't care about tool origin — they instrument the flow.
    const ctx = makeFlowCtx({ input: { name: 'openapi_getUsers' }, _toolOwnerId: 'OpenapiAdapter' });

    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);
    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool openapi_getUsers');
    expect(toolSpan).toBeTruthy();
    expect(toolSpan!.attributes['frontmcp.tool.owner']).toBe('OpenapiAdapter');
    expect(toolSpan!.attributes['mcp.component.type']).toBe('tool');
  });
});

describe('Integration: Job/workflow execution (via tool flow)', () => {
  beforeEach(() => exporter.reset());

  it('should trace job execution as a tool call', () => {
    // Jobs are executed via execute-job tool, which goes through tools:call-tool flow
    const ctx = makeFlowCtx({ input: { name: 'execute-job' }, _toolOwnerId: 'JobExecutionManager' });

    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);
    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool execute-job');
    expect(toolSpan).toBeTruthy();
    expect(toolSpan!.spanContext().traceId).toBe(TRACE_ID);
  });
});

describe('Integration: Session tracing ID consistency', () => {
  beforeEach(() => exporter.reset());

  it('should use the same session hash across all spans in a request', () => {
    const ctx = makeFlowCtx();

    // Multiple flows in same request
    onHttpWillTrace(TRACE_OPTS, ctx);
    onToolWillParse(TRACE_OPTS, ctx);
    onToolWillExecute(TRACE_OPTS, ctx);
    onToolDidExecute(TRACE_OPTS, ctx);
    onToolDidFinalize(ctx);
    onHttpDidFinalize(ctx);

    const spans = exporter.getFinishedSpans();
    const sessionIds = spans
      .map((s) => s.attributes['mcp.session.id'] || s.attributes['frontmcp.session.id_hash'])
      .filter(Boolean);

    // All non-undefined session IDs should be the same hash
    const unique = new Set(sessionIds);
    expect(unique.size).toBeLessThanOrEqual(1);
    if (sessionIds.length > 0) {
      expect(sessionIds[0]).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});
