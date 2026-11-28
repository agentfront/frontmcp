/**
 * Detached workflow runs (#1351): `@Workflow({ runner: 'detached' })` runs in a process of its own, keeps its run in
 * the job store, and is cancelled through the store by any server on it. The runner's entry runs in this process here,
 * as the second instance a spawned runner would boot.
 */
import 'reflect-metadata';

import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, resetRuntimeContext, rm } from '@frontmcp/utils';

import { App, Job, JobContext, LogLevel, Workflow, type JobPermission } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { JobRunnerUnavailableError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { JobExecutionManager } from '../execution/job-execution.manager';
import { appsForRun, runDetachedJob } from '../runner/detached-job.worker';
import { assertWorkflowRunnersAvailable } from '../runner/job-runner';
import { type JobStateStore, type WorkflowRunRecord } from '../store/job-state.interface';

// A runner of this file's servers would run jest again: every spawn is a stand-in
jest.mock('../runner/job-runner', () => ({
  ...jest.requireActual('../runner/job-runner'),
  spawnDetachedRunner: jest.fn(() => ({ pid: process.pid, once: () => undefined })),
}));

const steps: string[] = [];
let openGate: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();

function closeGate(): void {
  gate = new Promise((resolve) => {
    openGate = resolve;
  });
}

const OPEN: JobPermission[] = [{ action: 'read' }, { action: 'delete' }];

@Job({ name: 'first_step', inputSchema: { tag: z.string() }, outputSchema: { pid: z.number() }, timeout: 0 })
class FirstStepJob extends JobContext {
  async execute({ tag }: { tag: string }) {
    steps.push(`${tag}:first`);
    await gate;
    return { pid: process.pid };
  }
}

@Job({ name: 'second_step', inputSchema: { tag: z.string() }, outputSchema: { done: z.boolean() } })
class SecondStepJob extends JobContext {
  async execute({ tag }: { tag: string }) {
    steps.push(`${tag}:second`);
    return { done: true };
  }
}

@Job({
  name: 'guarded_step',
  inputSchema: {},
  outputSchema: {},
  permissions: [{ action: 'execute', roles: ['ops'] }],
})
class GuardedStepJob extends JobContext {
  async execute() {
    return {};
  }
}

@Workflow({
  name: 'two_steps',
  runner: 'detached',
  permissions: OPEN,
  inputSchema: { tag: z.string() },
  steps: [
    { id: 'first', jobName: 'first_step' },
    { id: 'second', jobName: 'second_step', dependsOn: ['first'] },
  ],
})
class TwoStepsFlow {}

@App({ id: 'flows', name: 'Flows', jobs: [FirstStepJob, SecondStepJob, GuardedStepJob], workflows: [TwoStepsFlow] })
class FlowsApp {}

let dir: string;
let dbPath: string;
const workers: Promise<number>[] = [];
const servers: DirectMcpServer[] = [];

function config() {
  return {
    info: { name: 'detached-workflows', version: '1.0.0' },
    apps: [FlowsApp],
    logging: { level: LogLevel.Off },
    sqlite: { path: dbPath },
  };
}

async function open(): Promise<DirectMcpServer> {
  const server = await FrontMcpInstance.createDirect(config());
  servers.push(server);
  return server;
}

function scopeOf(server: DirectMcpServer): Scope {
  return (server as unknown as { scope: Scope }).scope;
}

function storeOf(server: DirectMcpServer): JobStateStore {
  const store = (scopeOf(server) as unknown as { _jobStateStore?: JobStateStore })._jobStateStore;
  if (!store) throw new Error('jobs are not enabled');
  return store;
}

/** A manager on the server's scope whose detached runs start the runner's entry in this process. */
function starterOn(server: DirectMcpServer): JobExecutionManager {
  const scope = scopeOf(server);
  const jobs = scope.jobs;
  if (!jobs) throw new Error('jobs are not enabled');
  return new JobExecutionManager(storeOf(server), scope.logger, undefined, scope, {
    findJob: (name) => jobs.findByName(name),
    workflows: { find: (name) => scope.workflows?.findByName(name), jobs },
    spawnDetached: (runId) => {
      workers.push(runDetachedJob(config(), runId));
      return { pid: process.pid, once: () => undefined };
    },
  });
}

async function startTwoSteps(server: DirectMcpServer, tag: string) {
  const scope = scopeOf(server);
  const workflow = scope.workflows?.findByName('two_steps');
  const jobs = scope.jobs;
  if (!workflow || !jobs) throw new Error('the workflow is not registered');
  const starter = starterOn(server);
  const handle = await starter.executeWorkflow(workflow, jobs, {
    sessionId: 'alice-session',
    authInfo: { sessionId: 'alice-session', user: { sub: 'alice' } },
    workflowInput: { tag },
  });
  return { starter, handle };
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function runOf(server: DirectMcpServer, runId: string): Promise<WorkflowRunRecord | null> {
  return (await storeOf(server).getRun(runId)) as WorkflowRunRecord | null;
}

beforeEach(async () => {
  steps.length = 0;
  gate = Promise.resolve();
  dir = await mkdtemp(path.join(os.tmpdir(), 'sdk-detached-workflows-'));
  dbPath = path.join(dir, 'jobs.sqlite');
});

afterEach(async () => {
  openGate();
  await Promise.allSettled(workers.splice(0));
  for (const server of servers.splice(0)) await server.dispose().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('a detached workflow run', () => {
  it('answers at once, runs its steps in its runner and lands its result in the store', async () => {
    const server = await open();
    const { handle } = await startTwoSteps(server, 'w1');

    expect(handle).toEqual({ runId: expect.any(String), state: 'pending' });
    await waitFor(async () => (await runOf(server, handle.runId))?.state === 'completed', 'the run to complete');
    const run = await runOf(server, handle.runId);
    expect(run).toEqual(
      expect.objectContaining({
        workflowName: 'two_steps',
        background: true,
        runner: expect.objectContaining({ kind: 'detached', pid: process.pid }),
        result: expect.objectContaining({ state: 'completed' }),
      }),
    );
    expect(steps).toEqual(['w1:first', 'w1:second']);
  });

  it('is cancelled by another server on its store: its runner starts no more steps, and it ends cancelled', async () => {
    closeGate();
    const first = await open();
    const { handle } = await startTwoSteps(first, 'w2');
    await waitFor(() => steps.includes('w2:first'), 'the first step to start');

    const second = await open();
    await second.callTool(
      'cancel_job',
      { runId: handle.runId },
      {
        authContext: { sessionId: 'alice-session', user: { sub: 'alice' } },
      },
    );
    await Promise.allSettled(workers.splice(0));
    openGate();

    expect(await runOf(second, handle.runId)).toEqual(
      expect.objectContaining({ state: 'cancelled', error: expect.objectContaining({ name: 'JobCancelledError' }) }),
    );
    expect(steps).toEqual(['w2:first']);
  });

  it('is interrupted, with no job cleanup, when its runner died', async () => {
    const server = await open();
    const scope = scopeOf(server);
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    await storeOf(server).createRun({
      runId: 'orphan',
      jobId: 'two_steps',
      jobName: 'two_steps',
      workflowName: 'two_steps',
      sessionId: 'alice-session',
      state: 'running',
      input: { tag: 'w3' },
      startedAt: Date.now(),
      attempt: 1,
      maxAttempts: 1,
      logs: [],
      background: true,
      stepResults: {},
      scopeId: scope.id,
      runner: { kind: 'detached', id: 'runner-orphan', pid: dead, hostname: os.hostname() },
    } as WorkflowRunRecord);

    await starterOn(server).reconcile();

    expect(await runOf(server, 'orphan')).toEqual(
      expect.objectContaining({
        state: 'interrupted',
        error: expect.objectContaining({ name: 'JobInterruptedError' }),
      }),
    );
  });

  it('is refused by an in-process server, which has no entry a runner can run again', async () => {
    const server = await open();
    const caller = { authContext: { sessionId: 'alice-session', user: { sub: 'alice' } } };

    await expect(
      server.callTool('execute_workflow', { name: 'two_steps', input: { tag: 'w4' } }, caller),
    ).rejects.toThrow(/^Workflow "two_steps" cannot use its runner/);
  });

  it('fails its runner with a typed failure when the workflow is not on the server', async () => {
    const server = await open();
    const scope = scopeOf(server);
    await storeOf(server).createRun({
      runId: 'unknown',
      jobId: 'gone_flow',
      jobName: 'gone_flow',
      workflowName: 'gone_flow',
      state: 'pending',
      input: {},
      startedAt: Date.now(),
      attempt: 1,
      maxAttempts: 1,
      logs: [],
      background: true,
      stepResults: {},
      scopeId: scope.id,
      runner: { kind: 'detached', id: 'runner-unknown', pid: process.pid, hostname: os.hostname() },
    } as WorkflowRunRecord);

    await starterOn(server).runDetached('unknown');

    expect(await runOf(server, 'unknown')).toEqual(
      expect.objectContaining({
        state: 'failed',
        error: expect.objectContaining({
          name: 'JobRunnerBootError',
          message: expect.stringContaining('the server has no workflow named "gone_flow"'),
        }),
      }),
    );
  });
});

describe('a detached workflow at boot', () => {
  const find = (name: string) =>
    name === 'guarded_step'
      ? { name, metadata: { permissions: [{ action: 'execute' as const, roles: ['ops'] }] } }
      : { name, metadata: {} };

  afterEach(() => resetRuntimeContext());

  it('is refused where its process could not outlive the server', () => {
    const workflow = { name: 'flow', metadata: { runner: 'detached' as const, steps: [{ jobName: 'first_step' }] } };
    expect(() =>
      assertWorkflowRunnersAvailable([workflow], find, { runtime: 'node', deployment: 'serverless' }),
    ).toThrow(JobRunnerUnavailableError);
    expect(() =>
      assertWorkflowRunnersAvailable([workflow], find, { runtime: 'edge', deployment: 'standalone' }),
    ).toThrow(
      /^Workflow "flow" cannot use its runner: a detached run needs a process of its own, which the edge runtime/,
    );
  });

  it('is refused when a step job checks execute permissions, which its process could not pass', () => {
    const workflow = { name: 'flow', metadata: { runner: 'detached' as const, steps: [{ jobName: 'guarded_step' }] } };
    expect(() =>
      assertWorkflowRunnersAvailable([workflow], find, { runtime: 'node', deployment: 'standalone' }),
    ).toThrow(/the job "guarded_step" of its step checks execute permissions/);
  });

  it('leaves an inline workflow, and a step whose job is not registered yet, alone', () => {
    const inline = { name: 'inline', metadata: { steps: [{ jobName: 'guarded_step' }] } };
    const later = { name: 'later', metadata: { runner: 'detached' as const, steps: [{ jobName: 'not_yet' }] } };
    expect(() =>
      assertWorkflowRunnersAvailable([inline, later], (name) => (name === 'not_yet' ? undefined : find(name)), {
        runtime: 'node',
        deployment: 'standalone',
      }),
    ).not.toThrow();
  });
});

@Job({ name: 'other_job', inputSchema: {}, outputSchema: {} })
class OtherJob extends JobContext {
  async execute() {
    return {};
  }
}

@App({ id: 'other', name: 'Other', jobs: [OtherJob] })
class OtherApp {}

@Workflow({
  name: 'across_apps',
  steps: [
    { id: 'first', jobName: 'first_step' },
    { id: 'other', jobName: 'other_job' },
  ],
})
class AcrossAppsFlow {}

@App({ id: 'flows-only', name: 'FlowsOnly', workflows: [AcrossAppsFlow] })
class FlowsOnlyApp {}

describe("a runner with jobs.detached.boot 'app'", () => {
  it("names the app that declares the run's job, or the workflow's and its steps' jobs' apps", () => {
    const apps = [OtherApp, FlowsApp, FlowsOnlyApp];

    expect(appsForRun(apps, { jobName: 'other_job' })).toEqual([OtherApp]);
    expect(appsForRun(apps, { jobName: 'second_step' })).toEqual([FlowsApp]);
    expect(appsForRun(apps, { jobName: 'two_steps', workflowName: 'two_steps' })).toEqual([FlowsApp]);
    expect(appsForRun(apps, { jobName: 'across_apps', workflowName: 'across_apps' })).toEqual([
      OtherApp,
      FlowsApp,
      FlowsOnlyApp,
    ]);
  });

  it('names none, so the whole config boots, when the job is on no app declared as a class', () => {
    expect(appsForRun([OtherApp, { name: 'remote', url: 'http://localhost:1' }], { jobName: 'first_step' })).toBe(
      undefined,
    );
    expect(appsForRun([FlowsOnlyApp], { jobName: 'across_apps', workflowName: 'across_apps' })).toBeUndefined();
  });

  it("boots only the run's apps, and the whole config without the option", async () => {
    const server = await open();
    const booted: unknown[][] = [];
    const boot = async (bootConfig: { apps?: unknown[] }) => {
      booted.push(bootConfig.apps ?? []);
      throw new Error('stop after the boot');
    };
    await storeOf(server).createRun({
      runId: 'only-app',
      jobId: 'second_step',
      jobName: 'second_step',
      state: 'pending',
      input: { tag: 'w5' },
      startedAt: Date.now(),
      attempt: 1,
      maxAttempts: 1,
      logs: [],
      background: true,
      runner: { kind: 'detached', id: 'runner-only-app', pid: process.pid, hostname: os.hostname() },
    });
    const withApps = { ...config(), apps: [OtherApp, FlowsApp] };

    await runDetachedJob({ ...withApps, jobs: { enabled: true, detached: { boot: 'app' } } }, 'only-app', boot);
    await runDetachedJob({ ...withApps, jobs: { enabled: true } }, 'only-app', boot);

    expect(booted).toEqual([[FlowsApp], [OtherApp, FlowsApp]]);
  });
});
