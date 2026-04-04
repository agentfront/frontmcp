import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode, diag, DiagLogLevel } from '@opentelemetry/api';
import {
  onToolWillParse,
  onToolWillFindTool,
  onToolWillCheckAuth,
  onToolWillCreateContext,
  onToolWillValidateInput,
  onToolWillExecute,
  onToolDidExecute,
  onToolWillValidateOutput,
  onToolWillApplyUI,
  onToolDidFinalize,
  onResourceWillParse,
  onResourceWillFind,
  onResourceWillExecute,
  onResourceDidExecute,
  onResourceDidFinalize,
  onPromptWillParse,
  onPromptWillFind,
  onPromptWillExecute,
  onPromptDidExecute,
  onPromptDidFinalize,
  onAgentWillParse,
  onAgentWillFind,
  onAgentWillExecute,
  onAgentDidExecute,
  onAgentDidFinalize,
  onHttpWillTrace,
  onHttpWillAcquireQuota,
  onHttpDidAcquireQuota,
  onHttpWillCheckAuth,
  onHttpDidCheckAuth,
  onHttpWillRoute,
  onHttpDidRoute,
  onHttpDidFinalize,
  onGenericFlowWillStart,
  onGenericFlowStage,
  onGenericFlowDidFinalize,
  onTransportWillStart,
  onTransportDidRoute,
  onTransportStage,
  onTransportDidFinalize,
  onAuthWillStart,
  onAuthDidDetermineMode,
  onAuthStage,
  onAuthDidFinalize,
  wrapContextFetch,
  onAgentDidExecuteEnrich,
  reportStartup,
  sessionTracingId,
  SPAN_KEY,
  SPAN_CTX_KEY,
} from '../plugin/observability.hooks';
import type { TracingOptions } from '../otel/otel.types';

const DEFAULT_OPTS: TracingOptions = {
  httpSpans: true,
  executionSpans: true,
  hookSpans: false,
  fetchSpans: true,
  flowStageEvents: true,
};

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

function makeFlowCtx(traceId = 'a'.repeat(32), parentId = 'b'.repeat(16)) {
  return {
    state: {
      input: { name: 'test_tool', uri: 'file:///test', arguments: {} },
      _toolOwnerId: 'TestOwner',
    } as Record<string | symbol, unknown>,
    get: (token: unknown) => {
      if (token === Symbol.for('frontmcp:CONTEXT')) {
        return {
          requestId: 'req-001',
          sessionId: 'session-abc',
          scopeId: 'test-scope',
          traceContext: { traceId, parentId, traceFlags: 1, raw: `00-${traceId}-${parentId}-01` },
          authInfo: { clientId: 'user-123', scopes: ['read', 'write'] },
          metadata: { customHeaders: {} },
        };
      }
      return undefined;
    },
  };
}

describe('sessionTracingId', () => {
  it('should produce a 16-char hex hash', () => {
    expect(sessionTracingId('my-session')).toMatch(/^[a-f0-9]{16}$/);
  });
  it('should be consistent', () => {
    expect(sessionTracingId('abc')).toBe(sessionTracingId('abc'));
  });
  it('should differ for different inputs', () => {
    expect(sessionTracingId('a')).not.toBe(sessionTracingId('b'));
  });
});

describe('Auto-instrumentation Hooks', () => {
  beforeEach(() => exporter.reset());

  describe('Tool flow (full stage coverage)', () => {
    it('should create RPC + tool spans with all stage events', () => {
      const ctx = makeFlowCtx();
      onToolWillParse(DEFAULT_OPTS, ctx);
      onToolWillFindTool(ctx);
      onToolWillCheckAuth(ctx);
      onToolWillCreateContext(ctx);
      onToolWillValidateInput(ctx);
      onToolWillExecute(DEFAULT_OPTS, ctx);
      onToolDidExecute(DEFAULT_OPTS, ctx);
      onToolWillValidateOutput(ctx);
      onToolWillApplyUI(ctx);
      onToolDidFinalize(ctx);

      const spans = exporter.getFinishedSpans();
      const rpcSpan = spans.find((s) => s.name === 'tools/call');
      const toolSpan = spans.find((s) => s.name === 'tool test_tool');

      expect(rpcSpan).toBeTruthy();
      expect(toolSpan).toBeTruthy();
      expect(rpcSpan!.attributes['rpc.system']).toBe('mcp');
      expect(toolSpan!.attributes['mcp.component.type']).toBe('tool');
      expect(toolSpan!.attributes['enduser.id']).toBe('user-123');

      // Check stage events on RPC span
      const rpcEvents = rpcSpan!.events.map((e) => e.name);
      expect(rpcEvents).toContain('stage.parseInput');
      expect(rpcEvents).toContain('stage.findTool');
      expect(rpcEvents).toContain('stage.checkToolAuthorization');
      expect(rpcEvents).toContain('stage.validateInput');
      expect(rpcEvents).toContain('stage.validateOutput');
      expect(rpcEvents).toContain('stage.applyUI');
      expect(rpcEvents).toContain('stage.finalize');

      // Check stage events on tool span
      const toolEvents = toolSpan!.events.map((e) => e.name);
      expect(toolEvents).toContain('stage.execute.start');
      expect(toolEvents).toContain('stage.execute.done');
    });

    it('should share trace ID across all spans', () => {
      const traceId = 'c'.repeat(32);
      const ctx = makeFlowCtx(traceId);
      onToolWillParse(DEFAULT_OPTS, ctx);
      onToolWillExecute(DEFAULT_OPTS, ctx);
      onToolDidExecute(DEFAULT_OPTS, ctx);
      onToolDidFinalize(ctx);

      for (const span of exporter.getFinishedSpans()) {
        expect(span.spanContext().traceId).toBe(traceId);
      }
    });

    it('should record stage duration_ms in events', () => {
      const ctx = makeFlowCtx();
      onToolWillParse(DEFAULT_OPTS, ctx);
      onToolWillFindTool(ctx);
      onToolDidFinalize(ctx);

      const rpcSpan = exporter.getFinishedSpans().find((s) => s.name === 'tools/call');
      const findEvent = rpcSpan!.events.find((e) => e.name === 'stage.findTool');
      expect(findEvent?.attributes?.['duration_ms']).toBeDefined();
    });

    it('should record error on failure', () => {
      const ctx = makeFlowCtx();
      onToolWillParse(DEFAULT_OPTS, ctx);
      onToolWillExecute(DEFAULT_OPTS, ctx);
      ctx.state.error = new Error('boom');
      onToolDidFinalize(ctx);

      const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool test_tool');
      const rpcSpan = exporter.getFinishedSpans().find((s) => s.name === 'tools/call');
      expect(toolSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(rpcSpan!.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('should skip spans when executionSpans is false', () => {
      const ctx = makeFlowCtx();
      onToolWillParse({ ...DEFAULT_OPTS, executionSpans: false }, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });

    it('should handle missing context', () => {
      const ctx = { state: {} as Record<string | symbol, unknown>, get: () => undefined };
      onToolWillParse(DEFAULT_OPTS, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });
  });

  describe('Resource flow', () => {
    it('should create RPC + resource spans', () => {
      const ctx = makeFlowCtx();
      onResourceWillParse(DEFAULT_OPTS, ctx);
      onResourceWillFind(ctx);
      onResourceWillExecute(DEFAULT_OPTS, ctx);
      onResourceDidExecute(ctx);
      onResourceDidFinalize(ctx);

      expect(exporter.getFinishedSpans().find((s) => s.name === 'resources/read')).toBeTruthy();
      expect(exporter.getFinishedSpans().find((s) => s.name.startsWith('resource'))).toBeTruthy();
    });

    it('should record error', () => {
      const ctx = makeFlowCtx();
      onResourceWillParse(DEFAULT_OPTS, ctx);
      ctx.state.error = new Error('not found');
      onResourceDidFinalize(ctx);
      expect(exporter.getFinishedSpans().find((s) => s.name === 'resources/read')!.status.code).toBe(
        SpanStatusCode.ERROR,
      );
    });
  });

  describe('Prompt flow', () => {
    it('should create RPC + prompt spans', () => {
      const ctx = makeFlowCtx();
      onPromptWillParse(DEFAULT_OPTS, ctx);
      onPromptWillFind(ctx);
      onPromptWillExecute(DEFAULT_OPTS, ctx);
      onPromptDidExecute(ctx);
      onPromptDidFinalize(ctx);

      expect(exporter.getFinishedSpans().find((s) => s.name === 'prompts/get')).toBeTruthy();
      expect(exporter.getFinishedSpans().find((s) => s.name.startsWith('prompt'))).toBeTruthy();
    });
  });

  describe('Agent flow', () => {
    it('should create RPC + agent spans', () => {
      const ctx = makeFlowCtx();
      onAgentWillParse(DEFAULT_OPTS, ctx);
      onAgentWillFind(ctx);
      onAgentWillExecute(DEFAULT_OPTS, ctx);
      onAgentDidExecute(ctx);
      onAgentDidFinalize(ctx);

      const rpcSpan = exporter.getFinishedSpans().find((s) => s.name === 'agents/call');
      const agentSpan = exporter.getFinishedSpans().find((s) => s.name.startsWith('agent'));
      expect(rpcSpan).toBeTruthy();
      expect(agentSpan).toBeTruthy();
      expect(agentSpan!.attributes['mcp.component.type']).toBe('agent');
    });

    it('should record error', () => {
      const ctx = makeFlowCtx();
      onAgentWillParse(DEFAULT_OPTS, ctx);
      onAgentWillExecute(DEFAULT_OPTS, ctx);
      ctx.state.error = new Error('agent failed');
      onAgentDidFinalize(ctx);
      expect(exporter.getFinishedSpans().find((s) => s.name === 'agents/call')!.status.code).toBe(SpanStatusCode.ERROR);
    });
  });

  describe('HTTP flow (full stage coverage)', () => {
    it('should create HTTP span with all stage events', () => {
      const ctx = makeFlowCtx();
      onHttpWillTrace(DEFAULT_OPTS, ctx);
      onHttpWillAcquireQuota(ctx);
      onHttpDidAcquireQuota(ctx);
      onHttpWillCheckAuth(ctx);
      onHttpDidCheckAuth(ctx);
      onHttpWillRoute(ctx);
      onHttpDidRoute(ctx);
      onHttpDidFinalize(ctx);

      const httpSpan = exporter.getFinishedSpans()[0];
      expect(httpSpan).toBeTruthy();

      const events = httpSpan.events.map((e) => e.name);
      expect(events).toContain('stage.traceRequest');
      expect(events).toContain('stage.acquireQuota');
      expect(events).toContain('stage.checkAuthorization');
      expect(events).toContain('stage.router');
      expect(events).toContain('stage.finalize');
    });

    it('should set error for 5xx', () => {
      const ctx = makeFlowCtx();
      onHttpWillTrace(DEFAULT_OPTS, ctx);
      ctx.state.statusCode = 500;
      onHttpDidFinalize(ctx);
      expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
    });

    it('should not create span when httpSpans is false', () => {
      const ctx = makeFlowCtx();
      onHttpWillTrace({ ...DEFAULT_OPTS, httpSpans: false }, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });

    it('should handle missing span in finalize', () => {
      onHttpDidFinalize({ state: {} });
    });
  });

  describe('Generic flow helper', () => {
    it('should create a flow span', () => {
      const ctx = makeFlowCtx();
      onGenericFlowWillStart('skills/search', DEFAULT_OPTS, ctx);
      onGenericFlowStage('search', ctx);
      onGenericFlowDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.name).toBe('skills/search');
      expect(span.attributes['frontmcp.flow.name']).toBe('skills/search');
      expect(span.events.map((e) => e.name)).toContain('stage.search');
    });

    it('should record error', () => {
      const ctx = makeFlowCtx();
      onGenericFlowWillStart('test/flow', DEFAULT_OPTS, ctx);
      ctx.state.error = new Error('fail');
      onGenericFlowDidFinalize(ctx);
      expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
    });

    it('should skip when executionSpans is false', () => {
      const ctx = makeFlowCtx();
      onGenericFlowWillStart('test', { ...DEFAULT_OPTS, executionSpans: false }, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });

    it('should handle missing span in stage/finalize', () => {
      const ctx = { state: {} as Record<string | symbol, unknown> };
      onGenericFlowStage('test', ctx);
      onGenericFlowDidFinalize(ctx);
    });
  });

  describe('Transport flow', () => {
    it('should create transport span with stage events', () => {
      const ctx = makeFlowCtx();
      onTransportWillStart('streamable-http', DEFAULT_OPTS, ctx);
      onTransportDidRoute(ctx);
      onTransportStage('onInitialize', ctx);
      onTransportStage('onMessage', ctx);
      onTransportDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.name).toBe('transport streamable-http');
      expect(span.attributes['frontmcp.transport.type']).toBe('streamable-http');
      const events = span.events.map((e) => e.name);
      expect(events).toContain('stage.parseInput');
      expect(events).toContain('stage.router');
      expect(events).toContain('stage.onInitialize');
      expect(events).toContain('stage.onMessage');
      expect(events).toContain('stage.cleanup');
    });

    it('should set request type from state', () => {
      const ctx = makeFlowCtx();
      onTransportWillStart('legacy-sse', DEFAULT_OPTS, ctx);
      ctx.state.requestType = 'initialize';
      onTransportDidRoute(ctx);
      onTransportDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.attributes['frontmcp.transport.request_type']).toBe('initialize');
    });

    it('should skip when transportSpans is false', () => {
      const ctx = makeFlowCtx();
      onTransportWillStart('sse', { ...DEFAULT_OPTS, transportSpans: false }, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });

    it('should handle missing context', () => {
      const ctx = { state: {} as Record<string | symbol, unknown>, get: () => undefined };
      onTransportWillStart('sse', DEFAULT_OPTS, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });

    it('should handle missing span in stages', () => {
      onTransportDidRoute({ state: {} });
      onTransportStage('test', { state: {} });
      onTransportDidFinalize({ state: {} });
    });
  });

  describe('Auth flow', () => {
    it('should create auth span with stage events', () => {
      const ctx = makeFlowCtx();
      onAuthWillStart('auth:verify', DEFAULT_OPTS, ctx);
      onAuthDidDetermineMode(ctx);
      onAuthStage('verifyToken', ctx);
      onAuthDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.name).toBe('auth auth:verify');
      expect(span.attributes['frontmcp.flow.name']).toBe('auth:verify');
      expect(span.attributes['frontmcp.auth.result']).toBe('authorized');
    });

    it('should set auth mode from state', () => {
      const ctx = makeFlowCtx();
      onAuthWillStart('auth:verify', DEFAULT_OPTS, ctx);
      ctx.state.authMode = 'orchestrated';
      onAuthDidDetermineMode(ctx);
      onAuthDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.attributes['frontmcp.auth.mode']).toBe('orchestrated');
    });

    it('should record unauthorized on error', () => {
      const ctx = makeFlowCtx();
      onAuthWillStart('auth:verify', DEFAULT_OPTS, ctx);
      ctx.state.error = new Error('unauthorized');
      onAuthDidFinalize(ctx);

      const span = exporter.getFinishedSpans()[0];
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.attributes['frontmcp.auth.result']).toBe('unauthorized');
    });

    it('should skip when authSpans is false', () => {
      const ctx = makeFlowCtx();
      onAuthWillStart('auth:verify', { ...DEFAULT_OPTS, authSpans: false }, ctx);
      expect(ctx.state[SPAN_KEY]).toBeUndefined();
    });

    it('should handle missing span in stages', () => {
      onAuthDidDetermineMode({ state: {} });
      onAuthStage('test', { state: {} });
      onAuthDidFinalize({ state: {} });
    });
  });

  describe('Fetch instrumentation', () => {
    it('should wrap context fetch with span', async () => {
      const ctx = makeFlowCtx();
      onToolWillParse(DEFAULT_OPTS, ctx);
      onToolWillExecute(DEFAULT_OPTS, ctx);

      // Simulate tool context with fetch
      const mockResponse = { status: 200 } as Response;
      ctx.state.toolContext = {
        fetch: jest.fn().mockResolvedValue(mockResponse),
      };

      wrapContextFetch(DEFAULT_OPTS, ctx);

      // Call the wrapped fetch
      const result = await ctx.state.toolContext.fetch('https://api.example.com', { method: 'POST' });
      expect(result).toBe(mockResponse);

      onToolDidExecute(DEFAULT_OPTS, ctx);
      onToolDidFinalize(ctx);

      const fetchSpan = exporter.getFinishedSpans().find((s) => s.name === 'POST');
      expect(fetchSpan).toBeTruthy();
      expect(fetchSpan!.attributes['url.full']).toBe('https://api.example.com');
    });

    it('should record error on fetch failure', async () => {
      const ctx = makeFlowCtx();
      ctx.state.toolContext = {
        fetch: jest.fn().mockRejectedValue(new Error('network error')),
      };
      ctx.state[SPAN_CTX_KEY] = undefined;

      wrapContextFetch(DEFAULT_OPTS, ctx);

      await expect(ctx.state.toolContext.fetch('https://fail.com')).rejects.toThrow('network error');

      const fetchSpan = exporter.getFinishedSpans().find((s) => s.name === 'GET');
      expect(fetchSpan).toBeTruthy();
      expect(fetchSpan!.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('should skip when fetchSpans is false', () => {
      const ctx = makeFlowCtx();
      const origFetch = jest.fn();
      ctx.state.toolContext = { fetch: origFetch };

      wrapContextFetch({ ...DEFAULT_OPTS, fetchSpans: false }, ctx);
      expect(ctx.state.toolContext.fetch).toBe(origFetch);
    });

    it('should handle missing context', () => {
      wrapContextFetch(DEFAULT_OPTS, { state: {} });
    });
  });

  describe('Agent metadata enrichment', () => {
    it('should add iterations to agent span', () => {
      const ctx = makeFlowCtx();
      onAgentWillParse(DEFAULT_OPTS, ctx);
      onAgentWillExecute(DEFAULT_OPTS, ctx);

      // Simulate execution metadata
      ctx.state.executionMeta = { iterations: 3, durationMs: 1500 };
      onAgentDidExecuteEnrich(ctx);
      onAgentDidExecute(ctx);
      onAgentDidFinalize(ctx);

      const agentSpan = exporter.getFinishedSpans().find((s) => s.name.startsWith('agent'));
      expect(agentSpan!.attributes['frontmcp.agent.iterations']).toBe(3);
    });

    it('should handle missing exec span', () => {
      onAgentDidExecuteEnrich({ state: {} });
    });

    it('should handle missing executionMeta', () => {
      const ctx = makeFlowCtx();
      onAgentWillParse(DEFAULT_OPTS, ctx);
      onAgentWillExecute(DEFAULT_OPTS, ctx);
      onAgentDidExecuteEnrich(ctx);
      onAgentDidExecute(ctx);
      onAgentDidFinalize(ctx);
    });
  });

  describe('Startup report', () => {
    it('should emit a startup span', () => {
      reportStartup({
        toolsCount: 15,
        resourcesCount: 3,
        promptsCount: 2,
        pluginsCount: 4,
        durationMs: 250,
        scopeId: 'test',
      });

      const span = exporter.getFinishedSpans().find((s) => s.name === 'frontmcp.startup');
      expect(span).toBeTruthy();
      expect(span!.attributes['frontmcp.startup.tools_count']).toBe(15);
      expect(span!.attributes['frontmcp.startup.resources_count']).toBe(3);
      expect(span!.attributes['frontmcp.startup.plugins_count']).toBe(4);
      expect(span!.attributes['frontmcp.startup.duration_ms']).toBe(250);
    });
  });
});
