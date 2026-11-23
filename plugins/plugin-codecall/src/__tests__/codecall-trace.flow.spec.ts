/**
 * The trace of a `codecall:execute` run, for the agent in its result and for the operator as OpenTelemetry spans,
 * both from the run's journal, the same on both runtimes, and without argument or result values unless configured.
 */
import 'reflect-metadata';

import { diag, DiagLogLevel, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

import { ObservabilityPlugin } from '@frontmcp/observability';
import { App, connect, LogLevel, Tool, ToolContext, z, type CallToolResult, type DirectClient } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallVmRuntime } from '../codecall.types';

jest.setTimeout(30000);

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
diag.setLogger({ debug() {}, info() {}, warn() {}, error() {}, verbose() {} }, DiagLogLevel.NONE);
trace.setGlobalTracerProvider(provider);

@Tool({ name: 'users.get', description: 'Gets a user for the trace spec', inputSchema: { id: z.number() } })
class GetUserTool extends ToolContext {
  async execute({ id }: { id: number }) {
    return { id, name: `secret-name-${id}` };
  }
}

@Tool({ name: 'users.fail', description: 'Fails for the trace spec', inputSchema: {} })
class FailingTool extends ToolContext {
  async execute(): Promise<never> {
    throw new Error('internal');
  }
}

interface ExecuteOutcome {
  status: string;
  runId?: string;
  trace?: string[];
}

function serverConfig(options: CodeCallPluginOptionsInput, observability: boolean) {
  @App({
    id: 'people',
    name: 'People',
    tools: [GetUserTool, FailingTool],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only', runs: { storage: { type: 'memory' } }, ...options })],
  })
  class PeopleApp {}

  return {
    info: { name: 'codecall-trace', version: '1.0.0' },
    apps: [PeopleApp],
    logging: { level: LogLevel.Off },
    plugins: observability ? [ObservabilityPlugin.init({})] : [],
  };
}

const clients: DirectClient[] = [];

async function execute(config: ReturnType<typeof serverConfig>, script: string): Promise<ExecuteOutcome> {
  const client = await connect(config, { session: { id: 'trace-session' } });
  clients.push(client);
  const result = (await client.callTool('codecall:execute', { script })) as CallToolResult;
  return result.structuredContent as unknown as ExecuteOutcome;
}

const THREE_CALLS =
  "const a = await callTool('users.get', { id: 1 });\n" +
  "const b = await callTool('users.get', { id: 2 });\n" +
  'const c = await users.get({ id: 3 });\n' +
  'return [a.id, b.id, c.id];';

const FAILS_AFTER_TWO_CALLS =
  "await callTool('users.get', { id: 1 });\n" +
  "await callTool('users.get', { id: 2 });\n" +
  "return await callTool('users.fail', {});";

function codecallSpans(): ReadableSpan[] {
  return exporter.getFinishedSpans().filter((span) => span.name.startsWith('codecall '));
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  exporter.reset();
});

afterAll(async () => {
  await provider.shutdown();
});

describe.each<CodeCallVmRuntime>(['node-vm', 'interpreter'])('codecall:execute trace on the %s runtime', (runtime) => {
  const vm = { preset: 'secure' as const, runtime };

  describe('for the agent', () => {
    it('lists the calls a failed script made before it failed, by default, with sizes and no values', async () => {
      const outcome = await execute(serverConfig({ vm }, false), FAILS_AFTER_TWO_CALLS);

      expect(outcome.status).toBe('tool_error');
      expect(outcome.trace).toEqual([
        expect.stringMatching(/^1\. users\.get: success, \d+ ms, 31 bytes$/),
        expect.stringMatching(/^2\. users\.get: success, \d+ ms, 31 bytes$/),
        expect.stringMatching(/^3\. users\.fail: failure \(execute\), \d+ ms$/),
      ]);
    });

    it('lists nothing for a script that returned, by default', async () => {
      const outcome = await execute(serverConfig({ vm }, false), THREE_CALLS);

      expect(outcome.status).toBe('ok');
      expect(outcome).not.toHaveProperty('trace');
    });

    it("lists every run's calls at the calls level, and none when off", async () => {
      const calls = await execute(serverConfig({ vm, trace: { level: 'calls' } }, false), THREE_CALLS);
      const off = await execute(serverConfig({ vm, trace: { level: 'off' } }, false), FAILS_AFTER_TWO_CALLS);

      expect(calls.trace).toHaveLength(3);
      expect(off).not.toHaveProperty('trace');
    });

    it('shows arguments and results with trace.values', async () => {
      const outcome = await execute(serverConfig({ vm, trace: { values: true } }, false), FAILS_AFTER_TWO_CALLS);

      expect(outcome.trace?.[0]).toMatch(/, arguments \{"id":1\}, result \{"id":1,"name":"secret-name-1"\}$/);
    });
  });

  describe('for the operator', () => {
    it('sends a run span and a child span per tool call while observability is on, without values', async () => {
      const outcome = await execute(serverConfig({ vm }, true), THREE_CALLS);

      const spans = codecallSpans();
      const runSpan = spans.find((span) => span.name === 'codecall run');
      const callSpans = spans.filter((span) => span.name === 'codecall call users.get');
      expect(runSpan?.attributes).toMatchObject({
        'codecall.run.id': outcome.runId,
        'codecall.run.status': 'ok',
        'codecall.run.calls': 3,
        'codecall.vm.runtime': runtime,
        'codecall.script.hash': expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(runSpan?.status.code).toBe(SpanStatusCode.OK);
      expect(callSpans.map((span) => span.attributes)).toEqual(
        [1, 2, 3].map((position) => ({
          'codecall.call.position': position,
          'codecall.call.tool': 'users.get',
          'codecall.call.outcome': 'success',
          'codecall.call.duration_ms': expect.any(Number),
          'codecall.call.result_bytes': 31,
        })),
      );
      for (const span of callSpans) {
        expect(span.parentSpanContext?.spanId).toBe(runSpan?.spanContext().spanId);
      }
      expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain('secret-name');
    });

    it('marks a failed run and its failed call as errors', async () => {
      await execute(serverConfig({ vm }, true), FAILS_AFTER_TWO_CALLS);

      const spans = codecallSpans();
      const runSpan = spans.find((span) => span.name === 'codecall run');
      const failed = spans.find((span) => span.name === 'codecall call users.fail');
      expect(runSpan?.status).toMatchObject({ code: SpanStatusCode.ERROR, message: 'tool_error' });
      expect(failed?.status.code).toBe(SpanStatusCode.ERROR);
      expect(failed?.attributes).toMatchObject({
        'codecall.call.outcome': 'failure',
        'codecall.call.phase': 'execute',
      });
    });

    it('puts arguments and results on the call spans with trace.values', async () => {
      await execute(serverConfig({ vm, trace: { values: true } }, true), THREE_CALLS);

      const [first] = codecallSpans().filter((span) => span.name === 'codecall call users.get');
      expect(first?.attributes).toMatchObject({
        'codecall.call.arguments': '{"id":1}',
        'codecall.call.result': '{"id":1,"name":"secret-name-1"}',
      });
    });

    it("puts the review's decision and findings on the run span, without the suggestion's values", async () => {
      const outcome = await execute(
        serverConfig({ vm, review: {} }, true),
        "return await callTool('users.get', { id: 'secret-name-7' });",
      );

      expect(outcome.status).toBe('needs_changes');
      const runSpan = codecallSpans().find((span) => span.name === 'codecall run');
      expect(runSpan?.attributes).toMatchObject({
        'codecall.run.status': 'needs_changes',
        'codecall.review.decision': 'needs_changes',
        'codecall.review.findings.count': 1,
        'codecall.review.findings.rules': 'input-schema',
        'codecall.review.findings': JSON.stringify([
          {
            rule: 'input-schema',
            message: 'users.get: "id" must be a number, not a string',
            toolName: 'users.get',
            location: { line: 1, column: 13 },
          },
        ]),
      });
      expect(JSON.stringify(runSpan?.attributes)).not.toContain('secret-name');
    });

    it('sends no span while observability is off', async () => {
      await execute(serverConfig({ vm }, false), THREE_CALLS);

      expect(codecallSpans()).toEqual([]);
    });
  });
});
