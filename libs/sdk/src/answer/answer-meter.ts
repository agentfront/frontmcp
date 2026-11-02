// file: libs/sdk/src/answer/answer-meter.ts

import type { CallToolResult } from '@frontmcp/protocol';

import type { MetricsOptionsInterface } from '../common/types/options/metrics';
import { requireOptionalModule } from '../scope/optional-dependency.util';

/** The `/metrics` counters of what tool answers cost, labelled `tool` and `client`. */
export const ANSWER_COUNTERS = {
  bytes: 'frontmcp_tool_answer_bytes_total',
  estimatedTokens: 'frontmcp_tool_answer_estimated_tokens_total',
  duplicatedBytes: 'frontmcp_tool_answer_duplicated_bytes_total',
} as const;

const COUNTER_DESCRIPTIONS: Record<keyof typeof ANSWER_COUNTERS, string> = {
  bytes: 'UTF-8 bytes of tool answers as JSON',
  estimatedTokens: 'Tokens tool answers cost, estimated as bytes / 4',
  duplicatedBytes: 'Bytes of tool answer text that repeats structuredContent',
};

/** What one answer costs. */
export interface AnswerCost {
  /** UTF-8 bytes of the answer as JSON. */
  bytes: number;
  /** `bytes / 4`, rounded up: a rough average for English text and JSON. */
  estimatedTokens: number;
  /** Bytes of text content that is exactly the JSON of `structuredContent`. */
  duplicatedBytes: number;
}

type CounterFactory = (
  name: string,
  description?: string,
) => { inc(by?: number, attributes?: Record<string, string>): void };

const encoder = new TextEncoder();

/** Whether `/metrics` serves the tool counters: it is on, and `include` leaves the `tools` category in. */
export function meteringEnabled(metrics: Pick<MetricsOptionsInterface, 'enabled' | 'include'> | undefined): boolean {
  if (metrics?.enabled !== true) return false;
  return !metrics.include || metrics.include.length === 0 || metrics.include.includes('tools');
}

export function measureAnswer(result: CallToolResult): AnswerCost {
  const bytes = encoder.encode(JSON.stringify(result)).byteLength;
  const structuredText = result.structuredContent === undefined ? undefined : JSON.stringify(result.structuredContent);
  const duplicatedBytes = result.content.reduce(
    (sum, block) =>
      block.type === 'text' && block.text === structuredText ? sum + encoder.encode(block.text).byteLength : sum,
    0,
  );
  return { bytes, estimatedTokens: Math.ceil(bytes / 4), duplicatedBytes };
}

function loadCounterFactory(): CounterFactory {
  return requireOptionalModule<{ createCounter: CounterFactory }>('@frontmcp/observability', () =>
    require('@frontmcp/observability'),
  ).createCounter;
}

/** Add an answer's cost to the `/metrics` counters. `client` is a platform name, so the labels stay bounded. */
export function recordAnswerCost(
  cost: AnswerCost,
  labels: { tool: string; client: string },
  createCounter: CounterFactory = loadCounterFactory(),
): void {
  for (const key of Object.keys(ANSWER_COUNTERS) as Array<keyof typeof ANSWER_COUNTERS>) {
    createCounter(ANSWER_COUNTERS[key], COUNTER_DESCRIPTIONS[key]).inc(cost[key], labels);
  }
}
