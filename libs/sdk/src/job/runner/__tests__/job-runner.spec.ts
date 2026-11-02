/**
 * Runner selection: a job's own `runner`, else `jobs.runner`, else inline; `detached` is refused at boot where a
 * process of its own cannot outlive the server, and for a job whose attempts check the caller's credentials.
 */
import 'reflect-metadata';

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { z } from '@frontmcp/lazy-zod';

import { Job, JobContext, type JobPermission, type JobRunner } from '../../../common';
import { JobRunnerUnavailableError } from '../../../errors';
import {
  assertRunnersAvailable,
  detachedJobRunId,
  detachedRunnerCommand,
  JOB_WORKER_MARKER,
  RUN_JOB_ENV_VAR,
  runnerOf,
  spawnDetachedRunner,
} from '../job-runner';

const node = { runtime: 'node', deployment: 'standalone' };

function job(name: string, metadata: { runner?: JobRunner; permissions?: JobPermission[] } = {}) {
  return { name, metadata };
}

describe('runnerOf', () => {
  it("is the job's own runner, else the server's, else inline", () => {
    expect(runnerOf(job('a', { runner: 'worker' }), 'detached')).toBe('worker');
    expect(runnerOf(job('a'), 'detached')).toBe('detached');
    expect(runnerOf(job('a'))).toBe('inline');
  });
});

describe('@Job({ runner })', () => {
  it('takes the three runners', () => {
    for (const runner of ['inline', 'worker', 'detached'] as const) {
      expect(() =>
        Job({ name: `ok-${runner}`, inputSchema: {}, outputSchema: {}, runner })(
          class extends JobContext {
            async execute() {
              return {};
            }
          },
        ),
      ).not.toThrow();
    }
  });

  it('refuses another runner with the ones it takes', () => {
    expect(() =>
      Job({
        name: 'bad',
        inputSchema: { n: z.number() },
        outputSchema: {},
        runner: 'thread' as never,
      })(
        class extends JobContext {
          async execute(_input: { n: number }) {
            return {};
          }
        },
      ),
    ).toThrow(/runner must be 'inline', 'worker' or 'detached'/);
  });
});

describe('assertRunnersAvailable', () => {
  it('lets inline and worker jobs run anywhere', () => {
    const jobs = [job('a'), job('b', { runner: 'worker' })];
    expect(() => assertRunnersAvailable(jobs, undefined, { runtime: 'edge', deployment: 'serverless' })).not.toThrow();
  });

  it('lets a detached job run on a Node server that is not serverless', () => {
    expect(() => assertRunnersAvailable([job('a', { runner: 'detached' })], undefined, node)).not.toThrow();
  });

  it.each([
    [{ runtime: 'node', deployment: 'serverless' }, /serverless/],
    [{ runtime: 'edge', deployment: 'standalone' }, /edge runtime/],
    [{ runtime: 'browser', deployment: 'browser' }, /browser runtime/],
  ])('refuses a detached job on %j, with a remedy', (runtime, why) => {
    let refusal: unknown;
    try {
      assertRunnersAvailable([job('report', { runner: 'detached' })], undefined, runtime);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(JobRunnerUnavailableError);
    expect((refusal as JobRunnerUnavailableError).message).toMatch(why);
    expect((refusal as JobRunnerUnavailableError).message).toContain('Job "report"');
    expect((refusal as JobRunnerUnavailableError).remedy?.say).toMatch(/runner: 'inline'/);
    expect((refusal as JobRunnerUnavailableError).code).toBe('JOB_RUNNER_UNAVAILABLE');
  });

  it("refuses jobs.runner: 'detached' for a job that sets no runner, but not for one that sets its own", () => {
    const serverless = { runtime: 'node', deployment: 'serverless' };
    expect(() => assertRunnersAvailable([job('a')], 'detached', serverless)).toThrow(JobRunnerUnavailableError);
    expect(() => assertRunnersAvailable([job('a', { runner: 'inline' })], 'detached', serverless)).not.toThrow();
  });

  it('refuses a detached job with execute permissions: its process gets no caller credentials to check', () => {
    const guarded = job('guarded', { runner: 'detached', permissions: [{ action: 'execute', roles: ['ops'] }] });
    expect(() => assertRunnersAvailable([guarded], undefined, node)).toThrow(/execute permissions/);

    const readable = job('readable', { runner: 'detached', permissions: [{ action: 'read' }, { action: 'delete' }] });
    expect(() => assertRunnersAvailable([readable], undefined, node)).not.toThrow();
  });
});

describe('the detached runner process', () => {
  const { argv, execArgv } = process;

  afterEach(() => {
    process.argv = argv;
    process.execArgv = execArgv;
    delete process.env[RUN_JOB_ENV_VAR];
  });

  it("runs the server's own command again: node, its flags, its entry and arguments, without an older owner tag", () => {
    process.execArgv = ['--import', 'file:///repo/node_modules/tsx/dist/loader.mjs'];
    process.argv = [process.execPath, '/repo/dist/main.js', '--stdio', '--frontmcp-owner=frontmcp-task:42'];

    expect(detachedRunnerCommand()).toEqual({
      command: process.execPath,
      args: ['--import', 'file:///repo/node_modules/tsx/dist/loader.mjs', '/repo/dist/main.js', '--stdio'],
    });
  });

  it('is refused without an entry to run', () => {
    process.argv = [process.execPath];
    expect(() => detachedRunnerCommand()).toThrow(/no entry/);
  });

  it('reads the run it is for from its environment', () => {
    expect(detachedJobRunId()).toBeUndefined();
    process.env[RUN_JOB_ENV_VAR] = 'run-1';
    expect(detachedJobRunId()).toBe('run-1');
  });

  it('is marked for reapOrphans', () => {
    expect(JOB_WORKER_MARKER).toBe('frontmcp-job');
  });

  it('starts in a process group of its own, with the run id, the owner tag and no task id', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-job-runner-'));
    const report = path.join(dir, 'report.json');
    const entry = path.join(dir, 'entry.js');
    fs.writeFileSync(
      entry,
      `require('fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify({
        args: process.argv.slice(2),
        run: process.env.${RUN_JOB_ENV_VAR},
        owner: process.env.FRONTMCP_OWNER,
        task: process.env.FRONTMCP_RUN_TASK_ID ?? null,
      })); setTimeout(() => undefined, 1000);`,
    );
    process.execArgv = [];
    process.argv = [process.execPath, entry, '--quiet'];
    process.env['FRONTMCP_RUN_TASK_ID'] = 'task-1';
    try {
      const child = spawnDetachedRunner('run-9');
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(report) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));

      expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toEqual({
        args: ['--quiet', `--frontmcp-owner=frontmcp-job:${process.pid}`],
        run: 'run-9',
        owner: `frontmcp-job:${process.pid}`,
        task: null,
      });
      if (process.platform !== 'win32') {
        const group = execFileSync('ps', ['-o', 'pgid=', '-p', String(child.pid)])
          .toString()
          .trim();
        expect(Number(group)).toBe(child.pid);
      }
      process.kill(child.pid ?? 0, 'SIGKILL');
    } finally {
      delete process.env['FRONTMCP_RUN_TASK_ID'];
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
