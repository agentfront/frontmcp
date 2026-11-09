/**
 * A workflow's `inputSchema` is checked when a run starts, and the parsed input reaches the steps: a step without
 * `input` gets it, and each step's `input` and `condition` functions receive it.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, JobContext, LogLevel, Workflow } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { jobExecutionManagerOf } from '../../job/job-run-access';
import { type Scope } from '../../scope/scope.instance';

@Job({
  name: 'echo',
  inputSchema: {
    name: z.string().optional(),
    excited: z.boolean().optional(),
    greeting: z.string().optional(),
    extra: z.number().optional(),
  },
  outputSchema: {},
})
class EchoJob extends JobContext {
  async execute(input: Record<string, unknown>) {
    return input;
  }
}

@Workflow({
  name: 'greet',
  inputSchema: { name: z.string(), excited: z.boolean().default(false) },
  steps: [
    { id: 'plain', jobName: 'echo' },
    {
      id: 'shout',
      jobName: 'echo',
      condition: (_steps, input) => input['excited'] === true,
      input: (_steps, input) => ({ greeting: `Hi ${String(input['name'])}!` }),
    },
  ],
})
class GreetWorkflow {}

@Workflow({ name: 'free', steps: [{ id: 'plain', jobName: 'echo' }] })
class FreeWorkflow {}

@Workflow({
  name: 'guarded',
  inputSchema: { name: z.string() },
  permissions: [{ action: 'execute', roles: ['admin'] }],
  steps: [{ id: 'plain', jobName: 'echo' }],
})
class GuardedWorkflow {}

@App({ id: 'greeter', name: 'Greeter', jobs: [EchoJob], workflows: [GreetWorkflow, FreeWorkflow, GuardedWorkflow] })
class GreeterApp {}

interface WorkflowRun {
  runId: string;
  state: string;
  result: { stepResults: Record<string, { state: string; outputs: Record<string, unknown> }> };
}

describe('workflow input', () => {
  let server: DirectMcpServer;
  let scope: Scope;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'workflow-input', version: '1.0.0' },
      apps: [GreeterApp],
      logging: { level: LogLevel.Off },
    });
    scope = (server as unknown as { scope: Scope }).scope;
  });

  afterAll(async () => {
    await server.dispose();
  });

  async function runWorkflow(name: string, input?: Record<string, unknown>): Promise<WorkflowRun> {
    const response = await server.callTool('execute_workflow', { name, input });
    return response.structuredContent as unknown as WorkflowRun;
  }

  it('gives a step without input the workflow input, as its inputSchema parsed it', async () => {
    const run = await runWorkflow('greet', { name: 'Ada', extra: 1 });

    expect(run.state).toBe('completed');
    expect(run.result.stepResults['plain']).toEqual({ state: 'completed', outputs: { name: 'Ada', excited: false } });
    expect(run.result.stepResults['shout'].state).toBe('skipped');
  });

  it("passes the workflow input to a step's condition and input functions", async () => {
    const run = await runWorkflow('greet', { name: 'Ada', excited: true });

    expect(run.result.stepResults['shout']).toEqual({ state: 'completed', outputs: { greeting: 'Hi Ada!' } });
  });

  it('keeps the parsed input on the run record', async () => {
    const run = await runWorkflow('greet', { name: 'Ada', extra: 1 });

    const record = await manager().getStatus(run.runId);
    expect(record?.input).toEqual({ name: 'Ada', excited: false });
  });

  it('refuses input that does not match the inputSchema with INVALID_INPUT, before the run exists', async () => {
    const runsBefore = (await scopeRuns()).length;

    const refusal = await server.callTool('execute_workflow', { name: 'greet', input: { name: 7 } }).catch((e) => e);

    expect(refusal).toBeInstanceOf(InvalidInputError);
    expect(refusal.getPublicMessage()).toMatch(/^Invalid input for workflow "greet"\nDetails: /);
    expect(refusal.getPublicMessage()).toContain('"name"');
    expect(await scopeRuns()).toHaveLength(runsBefore);
  });

  it('passes the input on as given when the workflow has no inputSchema', async () => {
    const run = await runWorkflow('free', { name: 'Ada', extra: 1 });

    expect(run.result.stepResults['plain'].outputs).toEqual({ name: 'Ada', extra: 1 });
  });

  it('checks the execute permissions before the input, so a denied caller learns nothing of the schema', async () => {
    const workflow = scope.workflows?.findByName('guarded');
    const jobs = scope.jobs;
    if (!workflow || !jobs) throw new Error('the guarded workflow is not registered');

    await expect(manager().executeWorkflow(workflow, jobs, { authInfo: {}, workflowInput: {} })).rejects.toThrow(
      JobNotAuthorizedError,
    );
    await expect(
      manager().executeWorkflow(workflow, jobs, { authInfo: { user: { roles: ['admin'] } }, workflowInput: {} }),
    ).rejects.toThrow(InvalidInputError);
  });

  function manager() {
    const executionManager = jobExecutionManagerOf(scope);
    if (!executionManager) throw new Error('jobs are not enabled');
    return executionManager;
  }

  function scopeRuns() {
    return manager().listRuns();
  }
});
