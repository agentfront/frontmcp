import { join } from 'node:path';

import { ensureDir, writeFile } from '@frontmcp/utils';

import type { TokenUsage } from './model';
import type { EvalReport, TaskResult } from './suite';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatUsage(usage: TokenUsage): string {
  return [
    `input ${formatNumber(usage.inputTokens)}`,
    `cache read ${formatNumber(usage.cacheReadInputTokens)}`,
    `cache write ${formatNumber(usage.cacheCreationInputTokens)}`,
    `output ${formatNumber(usage.outputTokens)} tokens`,
  ].join(', ');
}

function formatTask({ id, check, metrics, transcript }: TaskResult): string[] {
  const flow = metrics.flow.length > 0 ? metrics.flow.join(' > ') : 'no tool calls';
  const lines = [
    `${check.passed ? 'PASS' : 'FAIL'} ${id}: ${metrics.toolCalls} tool calls (${flow}) in ${metrics.turns} turns, ${formatSeconds(metrics.latencyMs)}`,
    `     ${formatUsage(metrics.usage)}`,
  ];
  if (transcript.stopReason !== 'end_turn') {
    lines.push(`     stopped: ${transcript.stopReason}${transcript.error ? ` (${transcript.error})` : ''}`);
  }
  if (metrics.actedBeforeLoading) lines.push('     ran an action before loading a skill');
  if (metrics.reloadedSkills.length > 0) lines.push(`     reloaded ${metrics.reloadedSkills.join(', ')}`);
  return [...lines, ...check.failed.map((expectation) => `     - not met: ${expectation}`)];
}

/** The short text summary: one block per task, then the totals. */
export function formatSummary(report: EvalReport): string {
  const { totals } = report;
  const byName = Object.entries(totals.toolCallsByName)
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  return [
    `Skilled OpenAPI eval, ${report.model}: ${totals.passed} of ${totals.tasks} tasks passed`,
    '',
    ...report.tasks.flatMap(formatTask),
    '',
    `Tool calls: ${totals.toolCalls}${byName ? ` (${byName})` : ''} in ${totals.turns} turns`,
    `Tasks that searched: ${totals.tasksThatSearched}, ran an action before loading a skill: ${totals.tasksThatActedBeforeLoading}, reloaded a skill: ${totals.tasksThatReloadedASkill}`,
    `Tokens: ${formatUsage(totals.usage)}`,
    `Time: ${formatSeconds(totals.latencyMs)}`,
  ].join('\n');
}

/** Writes `<model>-<start time>.json` and `.txt` into `directory`, and returns their paths. */
export async function writeReport(
  report: EvalReport,
  directory: string,
): Promise<{ jsonPath: string; summaryPath: string }> {
  await ensureDir(directory);
  const name = `${report.model}-${report.startedAt.replace(/[:.]/g, '-')}`;
  const jsonPath = join(directory, `${name}.json`);
  const summaryPath = join(directory, `${name}.txt`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(summaryPath, `${formatSummary(report)}\n`);
  return { jsonPath, summaryPath };
}
