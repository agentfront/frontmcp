import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mkdtemp, readFile, rm } from '@frontmcp/utils';

import { measureTask, totalMetrics } from '../metrics';
import { formatSummary, writeReport } from '../report';
import type { TaskTranscript, ToolCallRecord } from '../run-task';
import type { EvalReport, TaskResult } from '../suite';

function call(name: string, skillId?: string): ToolCallRecord {
  return {
    name,
    input: {},
    text: '',
    isError: false,
    structuredContent: skillId ? { skill: { id: skillId } } : undefined,
    durationMs: 3,
  };
}

function taskResult(id: string, failed: string[], transcript: Partial<TaskTranscript>): TaskResult {
  const fullTranscript: TaskTranscript = {
    answer: '',
    stopReason: 'end_turn',
    turns: 3,
    toolCalls: [],
    usage: { inputTokens: 1_200, outputTokens: 80, cacheReadInputTokens: 2_400, cacheCreationInputTokens: 0 },
    latencyMs: 2_500,
    ...transcript,
  };
  return {
    id,
    prompt: `${id} prompt`,
    check: { passed: failed.length === 0, failed },
    metrics: measureTask(fullTranscript),
    transcript: fullTranscript,
    apiRequests: [],
  };
}

function reportOf(tasks: TaskResult[]): EvalReport {
  return {
    model: 'claude-sonnet-5-5',
    startedAt: '2026-11-04T10:20:30.400Z',
    maxTurns: 10,
    tasks,
    totals: totalMetrics(tasks),
  };
}

const passing = taskResult('invoice-status', [], {
  toolCalls: [call('search_skill'), call('load_skill', 'invoices'), call('execute_action')],
});
const failing = taskResult('refund-over-limit', ['the answer names the most that can be refunded, 120'], {
  stopReason: 'turn_limit',
  toolCalls: [call('execute_action'), call('load_skill', 'invoices'), call('load_skill', 'invoices')],
});

describe('formatSummary', () => {
  it('shows each task, what went wrong, and the totals', () => {
    expect(formatSummary(reportOf([passing, failing]))).toBe(
      [
        'Skilled OpenAPI eval, claude-sonnet-5-5: 1 of 2 tasks passed',
        '',
        'PASS invoice-status: 3 tool calls (search_skill > load_skill > execute_action) in 3 turns, 2.5 s',
        '     input 1,200, cache read 2,400, cache write 0, output 80 tokens',
        'FAIL refund-over-limit: 3 tool calls (execute_action > load_skill) in 3 turns, 2.5 s',
        '     input 1,200, cache read 2,400, cache write 0, output 80 tokens',
        '     stopped: turn_limit',
        '     ran an action before loading a skill',
        '     reloaded invoices',
        '     - not met: the answer names the most that can be refunded, 120',
        '',
        'Tool calls: 6 (search_skill 1, load_skill 3, execute_action 2) in 6 turns',
        'Tasks that searched: 1, ran an action before loading a skill: 1, reloaded a skill: 1',
        'Tokens: input 2,400, cache read 4,800, cache write 0, output 160 tokens',
        'Time: 5.0 s',
      ].join('\n'),
    );
  });

  it('names the error of a model request that failed', () => {
    const failed = taskResult('invoice-status', ['GET /v1/invoices/INV-1001 answered 200'], {
      stopReason: 'error',
      error: '401 authentication_error',
      turns: 1,
    });

    const summary = formatSummary(reportOf([failed]));

    expect(summary).toContain('FAIL invoice-status: 0 tool calls (no tool calls) in 1 turns');
    expect(summary).toContain('     stopped: error (401 authentication_error)');
    expect(summary).toContain('Tool calls: 0 in 1 turns');
  });
});

describe('writeReport', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skilled-eval-report-'));
  });

  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('writes the JSON report and the summary, named after the model and the start time', async () => {
    const report = reportOf([passing]);

    const { jsonPath, summaryPath } = await writeReport(report, join(directory, 'nested'));

    expect(jsonPath).toBe(join(directory, 'nested', 'claude-sonnet-5-5-2026-11-04T10-20-30-400Z.json'));
    expect(summaryPath).toBe(join(directory, 'nested', 'claude-sonnet-5-5-2026-11-04T10-20-30-400Z.txt'));
    expect(JSON.parse(await readFile(jsonPath))).toEqual(report);
    expect(await readFile(summaryPath)).toBe(`${formatSummary(report)}\n`);
  });
});
