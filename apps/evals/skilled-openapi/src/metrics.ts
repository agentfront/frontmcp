import { addUsage, NO_USAGE, type TokenUsage } from './model';
import type { TaskTranscript, ToolCallRecord } from './run-task';
import type { CheckResult } from './tasks';

const ACTION_TOOLS = new Set(['execute_action', 'run_workflow']);

export interface TaskMetrics {
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  /** The tools in the order they were called, a call repeated back to back shown once. */
  flow: string[];
  searched: boolean;
  /** An execute_action or run_workflow call came before any load_skill call. */
  actedBeforeLoading: boolean;
  /** The skills loaded more than once. */
  reloadedSkills: string[];
  turns: number;
  usage: TokenUsage;
  latencyMs: number;
}

export interface SuiteTotals {
  tasks: number;
  passed: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  tasksThatSearched: number;
  tasksThatActedBeforeLoading: number;
  tasksThatReloadedASkill: number;
  turns: number;
  usage: TokenUsage;
  latencyMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countByName(names: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

function mergeCounts(total: Record<string, number>, more: Record<string, number>): Record<string, number> {
  const merged = { ...total };
  for (const [name, count] of Object.entries(more)) merged[name] = (merged[name] ?? 0) + count;
  return merged;
}

/** The ids of the skills a load_skill call returned, for `skillId` (`skill`) and `skillIds` (`skills`). */
function loadedSkillIds(call: ToolCallRecord): string[] {
  if (call.name !== 'load_skill' || call.isError || !call.structuredContent) return [];
  const { skill, skills } = call.structuredContent;
  const loaded = Array.isArray(skills)
    ? skills.map((entry) => (isRecord(entry) ? entry['skill'] : undefined))
    : [skill];
  return loaded.flatMap((entry) => (isRecord(entry) && typeof entry['id'] === 'string' ? [entry['id']] : []));
}

function reloadedSkills(calls: readonly ToolCallRecord[]): string[] {
  const loaded = new Set<string>();
  const reloaded = new Set<string>();
  for (const skillId of calls.flatMap(loadedSkillIds)) {
    if (loaded.has(skillId)) reloaded.add(skillId);
    loaded.add(skillId);
  }
  return [...reloaded];
}

export function measureTask(transcript: TaskTranscript): TaskMetrics {
  const names = transcript.toolCalls.map((call) => call.name);
  const firstLoad = names.indexOf('load_skill');
  const firstAction = names.findIndex((name) => ACTION_TOOLS.has(name));
  return {
    toolCalls: names.length,
    toolCallsByName: countByName(names),
    flow: names.filter((name, index) => name !== names[index - 1]),
    searched: names.includes('search_skill'),
    actedBeforeLoading: firstAction !== -1 && (firstLoad === -1 || firstAction < firstLoad),
    reloadedSkills: reloadedSkills(transcript.toolCalls),
    turns: transcript.turns,
    usage: transcript.usage,
    latencyMs: transcript.latencyMs,
  };
}

export function totalMetrics(results: ReadonlyArray<{ check: CheckResult; metrics: TaskMetrics }>): SuiteTotals {
  const metrics = results.map((result) => result.metrics);
  const sum = (value: (task: TaskMetrics) => number) => metrics.reduce((total, task) => total + value(task), 0);
  return {
    tasks: results.length,
    passed: results.filter((result) => result.check.passed).length,
    toolCalls: sum((task) => task.toolCalls),
    toolCallsByName: metrics.reduce((counts, task) => mergeCounts(counts, task.toolCallsByName), {}),
    tasksThatSearched: metrics.filter((task) => task.searched).length,
    tasksThatActedBeforeLoading: metrics.filter((task) => task.actedBeforeLoading).length,
    tasksThatReloadedASkill: metrics.filter((task) => task.reloadedSkills.length > 0).length,
    turns: sum((task) => task.turns),
    usage: metrics.reduce((total, task) => addUsage(total, task.usage), NO_USAGE),
    latencyMs: sum((task) => task.latencyMs),
  };
}
