import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mkdtemp, readdir, readFile, rm } from '@frontmcp/utils';

import { runEvalCommand } from '../cli';
import { startEvalEnvironment, type EvalEnvironment } from '../environment';
import { scriptedModel } from '../scripted-model';
import { runSuite } from '../suite';
import { createEvalTasks, INVOICE, type EvalTask } from '../tasks';

function taskById(taskId: string): EvalTask {
  const task = createEvalTasks(new Date()).find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  return task;
}

describe('the dry run', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skilled-eval-dry-run-'));
  });

  afterAll(() => rm(directory, { recursive: true, force: true }));

  it('plays every task against the server and the billing API, passes them all, and writes the report', async () => {
    const printed: string[] = [];

    const report = await runEvalCommand(['--dry-run'], { SKILLED_EVAL_REPORT_DIR: directory }, (text) => {
      printed.push(text);
    });

    expect(report.model).toBe('scripted');
    expect(report.tasks.map((task) => [task.id, task.check])).toEqual(
      createEvalTasks(new Date()).map((task) => [task.id, { passed: true, failed: [] }]),
    );
    expect(report.totals).toMatchObject({
      tasks: 5,
      passed: 5,
      toolCalls: 11,
      toolCallsByName: { search_skill: 1, load_skill: 5, execute_action: 4, run_workflow: 1 },
      tasksThatSearched: 1,
      tasksThatActedBeforeLoading: 0,
      tasksThatReloadedASkill: 0,
    });

    const files = (await readdir(directory)).sort();
    expect(files).toEqual([expect.stringMatching(/^scripted-.+\.json$/), expect.stringMatching(/^scripted-.+\.txt$/)]);
    const json = await readFile(join(directory, files[0] ?? ''));
    expect(JSON.parse(json)).toEqual(report);
    expect(json).not.toContain('"authorization"');
    expect(json).not.toMatch(/Bearer /);
    expect(printed.join('\n')).toContain('Skilled OpenAPI eval, scripted: 5 of 5 tasks passed');
  });
});

describe('the harness against the server', () => {
  let environment: EvalEnvironment;

  beforeAll(async () => {
    environment = await startEvalEnvironment([INVOICE]);
  });

  afterAll(() => environment.stop());

  it('gives the model the four tools, and a catalog that leaves the account plan to a search', async () => {
    const session = await environment.connect();
    try {
      const searchSkill = session.tools.find((tool) => tool.name === 'search_skill');

      expect(session.tools.map((tool) => tool.name).sort()).toEqual([
        'execute_action',
        'load_skill',
        'run_workflow',
        'search_skill',
      ]);
      expect(session.instructions).toContain('load_skill');
      expect(searchSkill?.description).toContain('**Reports**');
      expect(searchSkill?.description).not.toMatch(/\bplan\b/i);
    } finally {
      await session.close();
    }
  });

  it('fails a run that refunds the wrong amount without loading a skill, whatever its answer claims', async () => {
    const careless: EvalTask = {
      ...taskById('refund-within-limit'),
      dryRun: {
        turns: [
          [{ name: 'execute_action', input: { actionId: 'refundInvoice', input: { id: INVOICE.id, amount: 60 } } }],
        ],
        answer: 'Refunded 50, the refund id is rfnd_1.',
      },
    };

    const report = await runSuite({
      model: scriptedModel([careless]),
      environment,
      tasks: [careless],
      maxTurns: 5,
      today: new Date(),
    });

    expect(report.tasks[0]?.check).toEqual({
      passed: false,
      failed: ['refunded 50 once (one POST /v1/invoices/INV-1001/refunds with amount 50 answered 201)'],
    });
    expect(report.tasks[0]?.metrics).toMatchObject({ flow: ['execute_action'], actedBeforeLoading: true });
    expect(report.tasks[0]?.apiRequests).toEqual([
      { method: 'POST', path: '/v1/invoices/INV-1001/refunds', query: '', body: { amount: 60 }, status: 201 },
    ]);
  });

  it('answers a tool the server does not have, and a failed workflow, as error results', async () => {
    const session = await environment.connect();
    try {
      const unknownTool = await session.callTool('delete_everything', {});
      const failedWorkflow = await session.callTool('run_workflow', {
        script: "return await callTool('getInvoice', { id: 'INV-404' });",
      });

      expect(unknownTool).toMatchObject({ isError: true, text: expect.stringContaining('delete_everything') });
      expect(failedWorkflow).toMatchObject({
        isError: true,
        text: expect.stringContaining('status 404'),
        structuredContent: { success: false },
      });
    } finally {
      await session.close();
    }
  });
});
