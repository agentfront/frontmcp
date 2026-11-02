import { FlowHooksOf, ResourceHook, ToolHook } from '@frontmcp/sdk';

import { DevEventStream, IpcDevEventSink, JsonlFileSink, type DevEventSink } from '../dev-events/dev-event-stream';
import { flowFailureOf, sessionTracingId } from '../plugin/observability.hooks';
import type { ResolvedDevEventsOptions, ResolvedStallOptions } from '../plugin/observability.options';
import { createCounter } from '../telemetry/telemetry.counters';
import type { CallMethod } from './in-flight-calls';
import { StallDetector } from './stall-detector';
import { countStall, describeStall, STALL_SECONDS_COUNTER, STALL_SECONDS_DESCRIPTION } from './stall-report';

const PromptHook = FlowHooksOf('prompts:get-prompt');

interface MonitorLogger {
  warn(message: string): void;
}

interface CallFlowContext {
  state?: {
    tool?: { fullName?: string };
    resource?: { fullName?: string };
    prompt?: { fullName?: string };
    flowError?: unknown;
    abandonedExecution?: unknown;
  };
  request?: { sessionId?: string };
  toolName?: string;
  promptName?: string;
}

function resolvedEntryOf(flow: CallFlowContext, method: CallMethod): string | undefined {
  if (method === 'tools/call') return flow.state?.tool?.fullName;
  if (method === 'resources/read') return flow.state?.resource?.fullName;
  return flow.state?.prompt?.fullName;
}

/** The entry's full name, else the name a tool call or prompt get asked for; a URI asked for is input, so never it. */
function reportedEntryOf(flow: CallFlowContext, method: CallMethod): string {
  const requested = method === 'tools/call' ? flow.toolName : method === 'prompts/get' ? flow.promptName : undefined;
  return resolvedEntryOf(flow, method) ?? requested ?? '';
}

function sessionOf(flow: CallFlowContext): { session?: string } {
  const sessionId = flow.request?.sessionId;
  return sessionId ? { session: sessionTracingId(sessionId).slice(0, 12) } : {};
}

function sinksOf(options: ResolvedDevEventsOptions): DevEventSink[] {
  return [
    ...(options.file ? [new JsonlFileSink(options.file)] : []),
    ...(options.ipc ? [new IpcDevEventSink()] : []),
    ...options.sinks,
  ];
}

/**
 * The server's stall detector and dev event stream. Its hooks keep each entry's execute stage in the calls in flight
 * (an `Around` hook, so a failed call ends too) and report each call when its flow ends (a `Finally` hook).
 */
export class CallMonitor {
  readonly stalls?: StallDetector;
  readonly devEvents?: DevEventStream;
  private readonly callStarts = new WeakMap<object, number>();

  constructor(
    stallOptions: ResolvedStallOptions | false,
    devEventsOptions: ResolvedDevEventsOptions | false,
    logger: MonitorLogger,
  ) {
    const devEvents = devEventsOptions
      ? new DevEventStream(sinksOf(devEventsOptions), { maxQueue: devEventsOptions.maxQueue, logger })
      : undefined;
    this.devEvents = devEvents;
    if (!stallOptions) return;
    const counter = createCounter(STALL_SECONDS_COUNTER, STALL_SECONDS_DESCRIPTION);
    this.stalls = new StallDetector({
      thresholdMs: stallOptions.thresholdMs,
      onStall: (report) => {
        logger.warn(describeStall(report));
        countStall(report, counter);
        devEvents?.emit({ type: 'stall', at: new Date().toISOString(), ...report });
      },
    });
  }

  onReady(): void {
    this.stalls?.start();
  }

  async onShutdown(): Promise<void> {
    this.stalls?.stop();
    await this.devEvents?.onShutdown();
  }

  @ToolHook.Will('parseInput', { priority: -1000 })
  markToolCallStart(ctx: unknown): void {
    this.markStart(ctx);
  }

  @ToolHook.Around('execute', { priority: -1000 })
  trackToolExecution(ctx: unknown, next: () => Promise<void>): Promise<void> {
    return this.track(ctx, 'tools/call', next);
  }

  @ToolHook.Finally('finalize', { priority: 1000 })
  reportToolCall(ctx: unknown): void {
    this.report(ctx, 'tools/call');
  }

  @ResourceHook.Will('parseInput', { priority: -1000 })
  markResourceReadStart(ctx: unknown): void {
    this.markStart(ctx);
  }

  @ResourceHook.Around('execute', { priority: -1000 })
  trackResourceExecution(ctx: unknown, next: () => Promise<void>): Promise<void> {
    return this.track(ctx, 'resources/read', next);
  }

  @ResourceHook.Finally('finalize', { priority: 1000 })
  reportResourceRead(ctx: unknown): void {
    this.report(ctx, 'resources/read');
  }

  @PromptHook.Will('parseInput', { priority: -1000 })
  markPromptGetStart(ctx: unknown): void {
    this.markStart(ctx);
  }

  @PromptHook.Around('execute', { priority: -1000 })
  trackPromptExecution(ctx: unknown, next: () => Promise<void>): Promise<void> {
    return this.track(ctx, 'prompts/get', next);
  }

  @PromptHook.Finally('finalize', { priority: 1000 })
  reportPromptGet(ctx: unknown): void {
    this.report(ctx, 'prompts/get');
  }

  private markStart(ctx: unknown): void {
    if (this.devEvents && typeof ctx === 'object' && ctx !== null) this.callStarts.set(ctx, performance.now());
  }

  private track(ctx: unknown, method: CallMethod, next: () => Promise<void>): Promise<void> {
    const flow = ctx as CallFlowContext;
    const entry = resolvedEntryOf(flow, method);
    // Calls are pruned only by the sampler, so none is kept while it does not run.
    if (!this.stalls?.running || !entry) return next();
    return this.stalls.calls.track({ method, entry, ...sessionOf(flow) }, next, () => flow.state?.abandonedExecution);
  }

  private report(ctx: unknown, method: CallMethod): void {
    if (!this.devEvents || typeof ctx !== 'object' || ctx === null) return;
    const startedAt = this.callStarts.get(ctx);
    if (startedAt === undefined) return;
    const flow = ctx as CallFlowContext;
    const failure = flow.state?.flowError ? flowFailureOf(flow.state.flowError) : undefined;
    this.devEvents.emit({
      type: 'call',
      at: new Date().toISOString(),
      method,
      entry: reportedEntryOf(flow, method),
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      outcome: failure ? 'error' : 'ok',
      ...(failure ? { error: { type: failure.type, code: failure.code } } : {}),
      ...sessionOf(flow),
    });
  }
}
