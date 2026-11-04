import { join } from 'node:path';

import { parseEvalOptions, runEval } from '../cli';
import { WORKSPACE_ROOT } from '../environment';
import { systemPrompt } from '../suite';

describe('parseEvalOptions', () => {
  it('runs every task with the current Sonnet model by default', () => {
    expect(parseEvalOptions([], {})).toEqual({
      dryRun: false,
      model: 'claude-sonnet-5-5',
      effort: undefined,
      maxTurns: 10,
      taskIds: undefined,
      reportDirectory: join(WORKSPACE_ROOT, 'dist/evals/skilled-openapi'),
    });
  });

  it('reads --dry-run and the SKILLED_EVAL_* variables', () => {
    const options = parseEvalOptions(['--dry-run'], {
      SKILLED_EVAL_MODEL: 'claude-opus-5-5',
      SKILLED_EVAL_EFFORT: 'medium',
      SKILLED_EVAL_MAX_TURNS: '4',
      SKILLED_EVAL_TASKS: 'invoice-status, refund-over-limit,',
      SKILLED_EVAL_REPORT_DIR: '/tmp/reports',
    });

    expect(options).toEqual({
      dryRun: true,
      model: 'claude-opus-5-5',
      effort: 'medium',
      maxTurns: 4,
      taskIds: ['invoice-status', 'refund-over-limit'],
      reportDirectory: '/tmp/reports',
    });
  });

  it('treats empty variables as unset', () => {
    const options = parseEvalOptions([], {
      SKILLED_EVAL_EFFORT: '',
      SKILLED_EVAL_MAX_TURNS: '',
      SKILLED_EVAL_TASKS: ' , ',
    });

    expect(options).toMatchObject({ effort: undefined, maxTurns: 10, taskIds: undefined });
  });

  it('refuses an unknown effort and a turn limit that is not a whole number of at least 1', () => {
    expect(() => parseEvalOptions([], { SKILLED_EVAL_EFFORT: 'extreme' })).toThrow(
      'SKILLED_EVAL_EFFORT must be one of low, medium, high, xhigh, max, not "extreme"',
    );
    for (const maxTurns of ['0', '2.5', 'ten']) {
      expect(() => parseEvalOptions([], { SKILLED_EVAL_MAX_TURNS: maxTurns })).toThrow(
        `SKILLED_EVAL_MAX_TURNS must be a whole number of at least 1, not "${maxTurns}"`,
      );
    }
  });
});

describe('runEval', () => {
  const options = parseEvalOptions([], {});

  it('refuses to start without ANTHROPIC_API_KEY, before it starts any server', async () => {
    await expect(runEval(options, undefined)).rejects.toThrow(
      'ANTHROPIC_API_KEY is not set: the eval sends real requests to the Claude API. Set it, or run the dry run (--dry-run).',
    );
  });

  it('refuses an unknown task and lists the tasks', async () => {
    await expect(runEval({ ...options, dryRun: true, taskIds: ['invoice-status', 'nope'] }, undefined)).rejects.toThrow(
      'unknown task nope: the tasks are invoice-status, refund-within-limit, refund-over-limit, export-revenue-report, account-plan-by-search',
    );
  });
});

describe('systemPrompt', () => {
  const today = new Date('2026-11-04T23:30:00Z');

  it("tells the model the server's name, the date and the server's instructions", () => {
    expect(systemPrompt('billing', 'This server has 3 skills.', today)).toBe(
      [
        'You are connected to the MCP server "billing". Do what the user asks with its tools, then answer in a few sentences with what the tools returned. No one can answer questions, so don\'t ask any.',
        'Today is 2026-11-04.',
        'This server has 3 skills.',
      ].join('\n\n'),
    );
  });

  it('leaves out instructions the server did not send', () => {
    expect(systemPrompt('billing', '', today)).not.toContain('\n\n\n');
    expect(systemPrompt('billing', '', today).endsWith('Today is 2026-11-04.')).toBe(true);
  });
});
