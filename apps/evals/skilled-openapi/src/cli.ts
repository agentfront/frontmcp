import { join } from 'node:path';

import {
  anthropicMessageSender,
  anthropicModel,
  DEFAULT_ANTHROPIC_MODEL,
  EFFORTS,
  type Effort,
} from './anthropic-model';
import { startEvalEnvironment, WORKSPACE_ROOT } from './environment';
import type { EvalModel } from './model';
import { formatSummary, writeReport } from './report';
import { scriptedModel } from './scripted-model';
import { runSuite, type EvalReport } from './suite';
import { createEvalTasks, INVOICE, type EvalTask } from './tasks';

const DEFAULT_MAX_TURNS = 10;

export interface EvalOptions {
  /** Play each task's scripted tool calls instead of asking a model. */
  dryRun: boolean;
  model: string;
  effort?: Effort;
  maxTurns: number;
  /** The tasks to run; all of them when left out. */
  taskIds?: string[];
  reportDirectory: string;
}

function parseEffort(value: string | undefined): Effort | undefined {
  if (value === undefined || value === '') return undefined;
  const effort = EFFORTS.find((candidate) => candidate === value);
  if (!effort) throw new Error(`SKILLED_EVAL_EFFORT must be one of ${EFFORTS.join(', ')}, not "${value}"`);
  return effort;
}

function parseMaxTurns(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_MAX_TURNS;
  const maxTurns = Number(value);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`SKILLED_EVAL_MAX_TURNS must be a whole number of at least 1, not "${value}"`);
  }
  return maxTurns;
}

/** Reads the options from the command's arguments and the environment; the API key is read separately. */
export function parseEvalOptions(argv: readonly string[], env: NodeJS.ProcessEnv): EvalOptions {
  const taskIds = env['SKILLED_EVAL_TASKS']
    ?.split(',')
    .map((taskId) => taskId.trim())
    .filter(Boolean);
  return {
    dryRun: argv.includes('--dry-run'),
    model: env['SKILLED_EVAL_MODEL'] || DEFAULT_ANTHROPIC_MODEL,
    effort: parseEffort(env['SKILLED_EVAL_EFFORT']),
    maxTurns: parseMaxTurns(env['SKILLED_EVAL_MAX_TURNS']),
    taskIds: taskIds && taskIds.length > 0 ? taskIds : undefined,
    reportDirectory: env['SKILLED_EVAL_REPORT_DIR'] || join(WORKSPACE_ROOT, 'dist/evals/skilled-openapi'),
  };
}

function selectTasks(tasks: EvalTask[], taskIds: string[] | undefined): EvalTask[] {
  if (!taskIds) return tasks;
  const unknown = taskIds.filter((taskId) => !tasks.some((task) => task.id === taskId));
  if (unknown.length > 0) {
    throw new Error(`unknown task ${unknown.join(', ')}: the tasks are ${tasks.map((task) => task.id).join(', ')}`);
  }
  return tasks.filter((task) => taskIds.includes(task.id));
}

function createModel(options: EvalOptions, tasks: EvalTask[], apiKey: string | undefined): EvalModel {
  if (options.dryRun) return scriptedModel(tasks);
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set: the eval sends real requests to the Claude API. Set it, or run the dry run (--dry-run).',
    );
  }
  return anthropicModel({
    model: options.model,
    effort: options.effort,
    createMessage: anthropicMessageSender(apiKey),
  });
}

export async function runEval(options: EvalOptions, apiKey: string | undefined): Promise<EvalReport> {
  const today = new Date();
  const tasks = selectTasks(createEvalTasks(today), options.taskIds);
  const model = createModel(options, tasks, apiKey);
  const environment = await startEvalEnvironment([INVOICE]);
  try {
    return await runSuite({ model, environment, tasks, maxTurns: options.maxTurns, today });
  } finally {
    await environment.stop();
  }
}

/** The `eval` command: runs the suite, writes the JSON report and the summary, and prints the summary. */
export async function runEvalCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  print: (text: string) => void,
): Promise<EvalReport> {
  const options = parseEvalOptions(argv, env);
  const report = await runEval(options, env['ANTHROPIC_API_KEY']);
  const { jsonPath, summaryPath } = await writeReport(report, options.reportDirectory);
  print(`${formatSummary(report)}\n\nReport: ${jsonPath}\nSummary: ${summaryPath}`);
  return report;
}
