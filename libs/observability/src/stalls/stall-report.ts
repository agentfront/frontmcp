import type { TelemetryCounter } from '../telemetry/telemetry.counters';
import type { StalledCall, StallReport } from './stall-detector';

/** Seconds the event loop was stalled, labelled `cause` (a call's method, `gc` or `unknown`) and `entry`. */
export const STALL_SECONDS_COUNTER = 'frontmcp_event_loop_stall_seconds_total';

export const STALL_SECONDS_DESCRIPTION =
  'Seconds the event loop was stalled, by the method and entry of each call in flight, or gc, or unknown';

const MAX_NAMED_CALLS = 5;

function describeCall(call: StalledCall): string {
  const session = call.session ? `, session ${call.session}` : '';
  return `${call.method} ${call.entry} (${call.runningMs} ms${session})`;
}

/** One log line: how long the loop stalled, how much of it was GC, and the calls in flight; never their inputs. */
export function describeStall(report: StallReport): string {
  const head = `Event loop stalled for ${report.stallMs} ms`;
  if (report.cause === 'gc') return `${head}, ${report.gcMs} ms of it in garbage collection`;
  const gc = report.gcMs > 0 ? ` (${report.gcMs} ms in garbage collection)` : '';
  if (report.calls.length === 0) return `${head}${gc} with no call in flight`;
  const named = report.calls.slice(0, MAX_NAMED_CALLS).map(describeCall).join(', ');
  const more = report.calls.length > MAX_NAMED_CALLS ? ` and ${report.calls.length - MAX_NAMED_CALLS} more` : '';
  return `${head}${gc} while running ${named}${more}`;
}

/** Adds GC time under `gc`, and the rest of a stall to each entry in flight once, or to `unknown`. */
export function countStall(report: StallReport, counter: TelemetryCounter): void {
  if (report.gcMs > 0) counter.inc(report.gcMs / 1000, { cause: 'gc', entry: '' });
  if (report.cause === 'gc') return;
  const seconds = (report.stallMs - report.gcMs) / 1000;
  if (report.calls.length === 0) {
    counter.inc(seconds, { cause: 'unknown', entry: '' });
    return;
  }
  const entries = new Map(report.calls.map((call) => [`${call.method} ${call.entry}`, call]));
  for (const call of entries.values()) counter.inc(seconds, { cause: call.method, entry: call.entry });
}
