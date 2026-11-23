import type { Reference } from '@frontmcp/sdk';

import type { RunCallValues, RunJournalObserver } from './run-journal';
import type { CodeCallRunInput } from './run-record.store';
import type { CodeCallJournalEntry } from './run-record.types';
import { valuePreviewOf } from './run-trace';

type SpanAttributes = Record<string, string | number | boolean>;

/** The part of `@frontmcp/observability`'s `TelemetrySpan` that run spans use. */
export interface RunTelemetrySpan {
  setAttributes(attributes: SpanAttributes): unknown;
  end(): void;
  endWithError(error: string): void;
  startChildSpan(name: string, attributes?: SpanAttributes): RunTelemetrySpan;
}

/** The part of `this.telemetry` that run spans use. */
export interface RunTelemetry {
  startSpan(name: string, attributes?: SpanAttributes): RunTelemetrySpan;
}

/** `this.telemetry`, which `@frontmcp/observability` registers while tracing is on; CodeCall does not depend on it. */
export const RunTelemetryToken = Symbol.for('frontmcp:observability:telemetry-accessor') as Reference<RunTelemetry>;

/** A span for a run, and a child span for each of its tool calls as its journal records them. */
export class RunSpans implements RunJournalObserver {
  private readonly callSpans = new Map<CodeCallJournalEntry, RunTelemetrySpan>();

  constructor(private readonly runSpan: RunTelemetrySpan) {}

  callStarted(entry: CodeCallJournalEntry): void {
    const span = this.runSpan.startChildSpan(`codecall call ${entry.tool}`, {
      'codecall.call.position': entry.position,
      'codecall.call.tool': entry.tool,
    });
    this.callSpans.set(entry, span);
  }

  callEnded(entry: CodeCallJournalEntry, values?: RunCallValues): void {
    const span = this.callSpans.get(entry);
    if (!span) return;
    this.callSpans.delete(entry);
    span.setAttributes({
      'codecall.call.outcome': entry.outcome,
      'codecall.call.duration_ms': entry.durationMs,
      ...(entry.phase && { 'codecall.call.phase': entry.phase }),
      ...(entry.resultBytes !== undefined && { 'codecall.call.result_bytes': entry.resultBytes }),
      ...(values && { 'codecall.call.arguments': valuePreviewOf(values.arguments) }),
      ...(values && entry.outcome === 'success' && { 'codecall.call.result': valuePreviewOf(values.result) }),
    });
    if (entry.outcome === 'failure') {
      span.endWithError(`failed in the ${entry.phase} phase`);
    } else {
      span.end();
    }
  }

  /** Ends the run span with what the run's record says, or with an error when the run threw before it had one. */
  end(run: CodeCallRunInput | undefined, runId: string | undefined): void {
    if (!run) {
      this.runSpan.endWithError('the run threw before it returned a result');
      return;
    }
    this.runSpan.setAttributes({
      'codecall.run.status': run.status,
      'codecall.run.calls': run.journal.length,
      ...(runId && { 'codecall.run.id': runId }),
      ...(run.resultBytes !== undefined && { 'codecall.run.result_bytes': run.resultBytes }),
      ...(run.reviewDecision !== null && { 'codecall.review.decision': run.reviewDecision }),
    });
    if (run.status === 'ok') {
      this.runSpan.end();
    } else {
      this.runSpan.endWithError(run.status);
    }
  }
}
