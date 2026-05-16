/**
 * Prometheus text-exposition serializer (zero-dep).
 *
 * Implements the Prometheus 0.0.4 text format documented at
 * https://prometheus.io/docs/instrumenting/exposition_formats/#text-based-format
 * without pulling in `prom-client` — keeps `@frontmcp/observability`'s
 * runtime footprint to `@opentelemetry/api` only (issue #397).
 *
 * Counter snapshot entries come from
 * `@frontmcp/observability`'s in-memory store (`getMetricSnapshot()`); gauge
 * entries come from the `ProcessStatsCollector` introduced alongside this
 * serializer.
 */

import type { CounterSnapshotEntry } from '../telemetry/telemetry.counters';

/**
 * A single gauge sample at a point in time. Values are emitted unchanged
 * (no resampling, no rate calculation).
 */
export interface GaugeSnapshotEntry {
  /** Metric name (must match `/^[a-zA-Z_:][a-zA-Z0-9_:]*$/`). */
  name: string;
  /** Sample value. NaN / non-finite values are dropped. */
  value: number;
  /** Optional bounded-cardinality labels. */
  attributes?: Record<string, string>;
  /** Optional `# HELP` line. */
  help?: string;
}

/**
 * Optional rendering knobs.
 */
export interface RenderOptions {
  /** Map of counter-name → `# HELP` text. Counter names not in the map omit the HELP line. */
  counterHelp?: Record<string, string>;
}

const METRIC_NAME_REGEX = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Content-Type emitted alongside the text format (canonical Prometheus
 * 0.0.4 value — pinned so consumers can match exactly).
 */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function sortedLabelString(attributes: Record<string, string>): string {
  const keys = Object.keys(attributes)
    .filter((k) => LABEL_NAME_REGEX.test(k))
    .sort();
  if (keys.length === 0) return '';
  const pairs = keys.map((k) => `${k}="${escapeLabelValue(attributes[k] ?? '')}"`);
  return `{${pairs.join(',')}}`;
}

function formatFloat(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/**
 * Render counter + gauge snapshots as Prometheus 0.0.4 text exposition.
 *
 * - Groups entries by metric name so `# HELP` / `# TYPE` lines emit once
 *   per metric.
 * - Drops entries whose metric name fails Prometheus naming validation.
 * - Sorts metric names alphabetically so output is byte-deterministic.
 * - Empty input → empty string.
 */
export function renderPrometheusExposition(
  counters: readonly CounterSnapshotEntry[],
  gauges: readonly GaugeSnapshotEntry[] = [],
  options: RenderOptions = {},
): string {
  type Grouped = { type: 'counter' | 'gauge'; help?: string; lines: string[] };
  const byName = new Map<string, Grouped>();

  for (const entry of counters) {
    if (!METRIC_NAME_REGEX.test(entry.name)) continue;
    const valueStr = formatFloat(entry.count);
    if (valueStr === '') continue;
    const labels = sortedLabelString(entry.attributes ?? {});
    const line = `${entry.name}${labels} ${valueStr}`;
    let group = byName.get(entry.name);
    if (!group) {
      group = {
        type: 'counter',
        help: options.counterHelp?.[entry.name],
        lines: [],
      };
      byName.set(entry.name, group);
    }
    group.lines.push(line);
  }

  for (const entry of gauges) {
    if (!METRIC_NAME_REGEX.test(entry.name)) continue;
    const valueStr = formatFloat(entry.value);
    if (valueStr === '') continue;
    const labels = sortedLabelString(entry.attributes ?? {});
    const line = `${entry.name}${labels} ${valueStr}`;
    let group = byName.get(entry.name);
    if (!group) {
      group = { type: 'gauge', help: entry.help, lines: [] };
      byName.set(entry.name, group);
    } else if (entry.help && !group.help) {
      group.help = entry.help;
    }
    group.lines.push(line);
  }

  if (byName.size === 0) return '';

  const sortedNames = Array.from(byName.keys()).sort();
  const blocks: string[] = [];
  for (const name of sortedNames) {
    const group = byName.get(name);
    if (!group) continue;
    const block: string[] = [];
    if (group.help) {
      block.push(`# HELP ${name} ${group.help.replace(/\n/g, ' ')}`);
    }
    block.push(`# TYPE ${name} ${group.type}`);
    block.push(...group.lines.slice().sort());
    blocks.push(block.join('\n'));
  }
  return blocks.join('\n') + '\n';
}

/**
 * Render counter + gauge snapshots as a JSON envelope — useful when
 * a consumer prefers JSON over Prometheus text parsing.
 */
export function renderJsonExposition(
  counters: readonly CounterSnapshotEntry[],
  gauges: readonly GaugeSnapshotEntry[] = [],
): { counters: CounterSnapshotEntry[]; gauges: GaugeSnapshotEntry[] } {
  return {
    counters: counters
      .filter((c) => METRIC_NAME_REGEX.test(c.name) && Number.isFinite(c.count))
      .map((c) => ({ name: c.name, count: c.count, attributes: { ...(c.attributes ?? {}) } })),
    gauges: gauges
      .filter((g) => METRIC_NAME_REGEX.test(g.name) && Number.isFinite(g.value))
      .map((g) => ({
        name: g.name,
        value: g.value,
        attributes: { ...(g.attributes ?? {}) },
        ...(g.help ? { help: g.help } : {}),
      })),
  };
}
