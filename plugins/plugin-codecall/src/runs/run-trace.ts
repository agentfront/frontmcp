import type { CodeCallTraceOptions } from '../codecall.types';
import type { RunCallValues, RunJournal } from './run-journal';
import type { CodeCallJournalEntry, CodeCallRunStatus } from './run-record.types';

/** How much of a value a trace line or a span shows with `trace.values`. */
const MAX_VALUE_PREVIEW_CHARS = 200;

/** A value as JSON, cut to 200 characters. */
export function valuePreviewOf(value: unknown): string {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > MAX_VALUE_PREVIEW_CHARS ? `${text.slice(0, MAX_VALUE_PREVIEW_CHARS)}...` : text;
}

/** A call's line: position, tool, outcome, duration and result size, then its values when they are kept. */
function traceLineOf(entry: CodeCallJournalEntry, values: RunCallValues | undefined): string {
  const outcome = entry.phase ? `${entry.outcome} (${entry.phase})` : entry.outcome;
  const size = entry.resultBytes === undefined ? '' : `, ${entry.resultBytes} bytes`;
  const line = `${entry.position}. ${entry.tool}: ${outcome}, ${entry.durationMs} ms${size}`;
  if (!values) return line;
  const result = entry.outcome === 'success' ? `, result ${valuePreviewOf(values.result)}` : '';
  return `${line}, arguments ${valuePreviewOf(values.arguments)}${result}`;
}

/** The trace a run's result carries, or undefined when `trace.level` shows none of its calls. */
export function traceOf(
  status: CodeCallRunStatus,
  journal: RunJournal,
  options: CodeCallTraceOptions,
): string[] | undefined {
  const entries = journal.close();
  const levelShowsRun = options.level === 'calls' || (options.level === 'failure' && status !== 'ok');
  if (!levelShowsRun || entries.length === 0) return undefined;
  const lineOf = (entry: CodeCallJournalEntry) => traceLineOf(entry, journal.valuesOf(entry));
  if (entries.length <= options.maxLines) return entries.map(lineOf);
  const shown = entries.slice(entries.length - options.maxLines + 1);
  return [`${entries.length - shown.length} earlier calls not shown`, ...shown.map(lineOf)];
}
