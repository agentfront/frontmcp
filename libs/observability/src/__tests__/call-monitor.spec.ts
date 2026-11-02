import { FrontMcpFlowHookTokens, FrontMcpLogger, PublicMcpError, type HookMetadata } from '@frontmcp/sdk';

import type { DevEvent, DevEventSink } from '../dev-events/dev-event-stream';
import ObservabilityPlugin from '../plugin/observability.plugin';
import { CallMonitor } from '../stalls/call-monitor';
import { getMetricSnapshot, resetTelemetrySnapshotForTesting } from '../telemetry/telemetry.counters';

function logger() {
  const log = { warn: jest.fn(), child: () => log };
  return log;
}

function recordingSink(): DevEventSink & { events: DevEvent[] } {
  const events: DevEvent[] = [];
  return { events, write: (batch) => void events.push(...batch) };
}

type MonitorProvider = { name: string; inject: () => unknown[]; useFactory: (logger: unknown) => CallMonitor };

function monitorProviderOf(input: ConstructorParameters<typeof ObservabilityPlugin>[0]): MonitorProvider | undefined {
  return ObservabilityPlugin.dynamicProviders(input ?? {}).find(
    (candidate) => (candidate as { provide?: unknown }).provide === CallMonitor,
  ) as MonitorProvider | undefined;
}

const toolFlow = (state: Record<string, unknown> = {}) => ({
  state: { tool: { fullName: 'probe:busy-wait' }, ...state },
  toolName: 'busy-wait',
  request: { sessionId: 'session-1' },
});

const stallsOnly = (thresholdMs = 200) => new CallMonitor({ thresholdMs }, false, logger());

describe('CallMonitor', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('is a provider of ObservabilityPlugin only when stalls or dev events are on, built from the SDK logger', () => {
    expect(monitorProviderOf({})).toBeUndefined();

    const provider = monitorProviderOf({ stalls: { thresholdMs: 100 } });
    expect(provider?.inject()).toEqual([FrontMcpLogger]);
    const monitor = provider?.useFactory(logger());
    expect(monitor?.stalls).toBeDefined();
    expect(monitor?.devEvents).toBeUndefined();

    process.env['FRONTMCP_DEV_EVENTS_FILE'] = '/tmp/events.jsonl';
    expect(monitorProviderOf({})?.useFactory(logger()).devEvents).toBeDefined();
  });

  it('declares Around hooks on execute and Finally hooks on finalize for tools, resources and prompts', () => {
    const hooks: HookMetadata[] = Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, CallMonitor) ?? [];
    const declared = hooks.map((hook) => `${hook.flow} ${hook.type} ${hook.stage}`);

    for (const flow of ['tools:call-tool', 'resources:read-resource', 'prompts:get-prompt']) {
      expect(declared).toEqual(
        expect.arrayContaining([`${flow} will parseInput`, `${flow} around execute`, `${flow} finally finalize`]),
      );
    }
  });

  it('holds a tool call in flight while its execute stage runs, and drops it when execute throws', async () => {
    const monitor = stallsOnly();
    let inFlight: unknown;

    await monitor.trackToolExecution(toolFlow(), async () => {
      inFlight = monitor.stalls?.calls.running().map(({ method, entry, session }) => ({ method, entry, session }));
    });
    expect(inFlight).toEqual([
      { method: 'tools/call', entry: 'probe:busy-wait', session: expect.stringMatching(/^[0-9a-f]{12}$/) },
    ]);

    await expect(
      monitor.trackToolExecution(toolFlow(), async () => {
        throw new Error('tool failed');
      }),
    ).rejects.toThrow('tool failed');
    expect(monitor.stalls?.calls.running()).toEqual([]);
  });

  it('tracks resource reads and prompt gets by their entry', async () => {
    const monitor = stallsOnly();
    const seen: string[] = [];
    const record = async () => {
      seen.push(...(monitor.stalls?.calls.running().map((call) => `${call.method} ${call.entry}`) ?? []));
    };

    await monitor.trackResourceExecution({ state: { resource: { fullName: 'docs:readme' } } }, record);
    await monitor.trackPromptExecution({ state: { prompt: { fullName: 'docs:summary' } } }, record);

    expect(seen).toEqual(['resources/read docs:readme', 'prompts/get docs:summary']);
  });

  it('runs execute untracked without a stall detector or a resolved entry', async () => {
    const next = jest.fn(async () => undefined);
    await new CallMonitor(false, false, logger()).trackToolExecution(toolFlow(), next);
    await stallsOnly().trackToolExecution({ state: {} }, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('writes a timed call event when a tool call ends, with the failure code and no input or answer', async () => {
    const sink = recordingSink();
    const monitor = new CallMonitor(false, { ipc: false, sinks: [sink], maxQueue: 10 }, logger());

    const ok = toolFlow({
      input: { arguments: { secret: 'input' } },
      output: { content: [{ type: 'text', text: 'answer' }] },
    });
    monitor.markToolCallStart(ok);
    monitor.reportToolCall(ok);
    const failed = toolFlow({ flowError: new PublicMcpError('Ticket not found', 'TICKET_NOT_FOUND', 404) });
    monitor.markToolCallStart(failed);
    monitor.reportToolCall(failed);
    monitor.reportToolCall(toolFlow());
    await monitor.devEvents?.flush();

    expect(sink.events).toEqual([
      {
        type: 'call',
        at: expect.any(String),
        method: 'tools/call',
        entry: 'probe:busy-wait',
        durationMs: expect.any(Number),
        outcome: 'ok',
        session: expect.stringMatching(/^[0-9a-f]{12}$/),
      },
      expect.objectContaining({ outcome: 'error', error: { type: 'PublicMcpError', code: 'TICKET_NOT_FOUND' } }),
    ]);
    expect(JSON.stringify(sink.events)).not.toMatch(/secret|answer/);
  });

  it('names a call that failed before its entry resolved by the tool or prompt name it asked for, never a URI', async () => {
    const sink = recordingSink();
    const monitor = new CallMonitor(false, { ipc: false, sinks: [sink], maxQueue: 10 }, logger());
    const tool = { state: {}, toolName: 'no-such-tool' };
    const prompt = { state: {}, promptName: 'no-such-prompt' };
    const resource = { state: {}, uri: 'file:///secret/path' };

    monitor.markToolCallStart(tool);
    monitor.reportToolCall(tool);
    monitor.markPromptGetStart(prompt);
    monitor.reportPromptGet(prompt);
    monitor.markResourceReadStart(resource);
    monitor.reportResourceRead(resource);
    await monitor.devEvents?.flush();

    expect(
      sink.events.map((event) => `${(event as { method: string }).method} ${(event as { entry: string }).entry}`),
    ).toEqual(['tools/call no-such-tool', 'prompts/get no-such-prompt', 'resources/read ']);
  });

  it('reports a stall as a warning, a metric and a dev event, and starts and stops with the server', async () => {
    resetTelemetrySnapshotForTesting();
    const sink = recordingSink();
    const log = logger();
    const monitor = new CallMonitor({ thresholdMs: 100 }, { ipc: false, sinks: [sink], maxQueue: 10 }, log);
    if (!monitor.stalls) throw new Error('no stall detector');
    const start = jest.spyOn(monitor.stalls, 'start');
    const stop = jest.spyOn(monitor.stalls, 'stop');

    monitor.onReady();
    expect(start).toHaveBeenCalled();
    monitor.stalls.onStall({ stallMs: 300, gcMs: 0, cause: 'unknown', calls: [] });
    await monitor.onShutdown();
    expect(stop).toHaveBeenCalled();

    expect(log.warn).toHaveBeenCalledWith('Event loop stalled for 300 ms with no call in flight');
    expect(sink.events).toEqual([
      { type: 'stall', at: expect.any(String), stallMs: 300, gcMs: 0, cause: 'unknown', calls: [] },
    ]);
    expect(getMetricSnapshot()).toEqual([
      { name: 'frontmcp_event_loop_stall_seconds_total', count: 0.3, attributes: { cause: 'unknown', entry: '' } },
    ]);
  });
});
