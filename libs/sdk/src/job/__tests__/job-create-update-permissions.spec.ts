/**
 * Permission rules for `create` and `update`. `create` gates submitting a run (`execute_job`, `execute_workflow`, a
 * webhook or an event), checked once with `execute` before the run exists, and not on a workflow step, which submits
 * no run of its job. `update` gates `update_job` / `update_workflow`, which change an entry registered at runtime.
 */
import 'reflect-metadata';

import { App, Job, JobContext, LogLevel, Workflow, type FrontMcpConfigInput } from '../../common';
import { JobKind, type JobDynamicRecord } from '../../common/records/job.record';
import { WorkflowKind } from '../../common/records/workflow.record';
import { type DirectAuthContext, type DirectMcpServer } from '../../direct/direct.types';
import { InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { jobExecutionManagerOf } from '../job-run-access';

const ran: string[] = [];
const admin = { user: { sub: 'ada', roles: ['admin'] } };
const member = { user: { sub: 'bob', roles: ['member'] } };

@Job({
  name: 'step-only',
  inputSchema: {},
  outputSchema: {},
  permissions: [{ action: 'create', roles: ['admin'] }],
})
class StepOnlyJob extends JobContext {
  async execute() {
    ran.push('step-only');
    return {};
  }
}

@Job({ name: 'open', inputSchema: {}, outputSchema: {} })
class OpenJob extends JobContext {
  async execute() {
    ran.push('open');
    return {};
  }
}

@Workflow({ name: 'uses-step-only', steps: [{ id: 'step', jobName: 'step-only' }] })
class UsesStepOnlyWorkflow {}

@Workflow({
  name: 'ci-only',
  permissions: [{ action: 'create', roles: ['ci'] }],
  steps: [{ id: 'open', jobName: 'open' }],
})
class CiOnlyWorkflow {}

@App({
  id: 'rules',
  name: 'Rules',
  jobs: [StepOnlyJob, OpenJob],
  workflows: [UsesStepOnlyWorkflow, CiOnlyWorkflow],
})
class RulesApp {}

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'create-update-rules', version: '1.0.0' },
  apps: [RulesApp],
  logging: { level: LogLevel.Off },
  jobs: { enabled: true, allowDynamicRegistration: true },
};

describe('create and update permission rules', () => {
  let server: DirectMcpServer;
  let scope: Scope;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(CONFIG);
    scope = (server as unknown as { scope: Scope }).scope;
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    ran.length = 0;
  });

  function manager() {
    const executionManager = jobExecutionManagerOf(scope);
    if (!executionManager) throw new Error('jobs are not enabled');
    return executionManager;
  }

  function entries() {
    const jobs = scope.jobs;
    const workflows = scope.workflows;
    if (!jobs || !workflows) throw new Error('jobs are not enabled');
    return { jobs, workflows };
  }

  describe('create', () => {
    it('refuses a run of a job to a caller its create rules deny, before the run exists', async () => {
      const job = entries().jobs.findByName('step-only');
      if (!job) throw new Error('step-only is not registered');
      const runsBefore = (await manager().listRuns()).length;

      await expect(manager().executeJob(job, {}, { authInfo: member })).rejects.toThrow(JobNotAuthorizedError);
      expect((await manager().listRuns()).length).toBe(runsBefore);
      expect(ran).toEqual([]);
      await expect(manager().executeJob(job, {}, { authInfo: admin })).resolves.toEqual(
        expect.objectContaining({ state: 'completed' }),
      );
      expect(ran).toEqual(['step-only']);
    });

    it("doesn't check a step job's create rules: a workflow step submits no run of its job", async () => {
      const { jobs, workflows } = entries();
      const workflow = workflows.findByName('uses-step-only');
      if (!workflow) throw new Error('uses-step-only is not registered');

      const run = await manager().executeWorkflow(workflow, jobs, { authInfo: member });

      expect(run.state).toBe('completed');
      expect(ran).toEqual(['step-only']);
    });

    it('refuses a run of a workflow to a caller its create rules deny', async () => {
      const { jobs, workflows } = entries();
      const workflow = workflows.findByName('ci-only');
      if (!workflow) throw new Error('ci-only is not registered');

      await expect(manager().executeWorkflow(workflow, jobs, { authInfo: member })).rejects.toThrow(
        JobNotAuthorizedError,
      );
      await expect(
        manager().executeWorkflow(workflow, jobs, { authInfo: { user: { roles: ['ci'] } } }),
      ).resolves.toEqual(expect.objectContaining({ state: 'completed' }));
    });

    it('leaves an entry a caller may not submit out of list_jobs and list_workflows', async () => {
      const listed = async (tool: 'list_jobs' | 'list_workflows', authContext: DirectAuthContext) => {
        const result = await server.callTool(tool, {}, { authContext });
        const content = result.structuredContent as { jobs?: { name: string }[]; workflows?: { name: string }[] };
        return (content.jobs ?? content.workflows ?? []).map((entry) => entry.name);
      };

      expect(await listed('list_jobs', member)).not.toContain('step-only');
      expect(await listed('list_jobs', member)).toContain('open');
      expect(await listed('list_jobs', admin)).toContain('step-only');
      expect(await listed('list_workflows', member)).not.toContain('ci-only');
      expect(await listed('list_workflows', member)).toContain('uses-step-only');
    });
  });

  describe('update', () => {
    const steps = [{ id: 'open', jobName: 'open' }];

    it('updates a job registered at runtime: the fields given replace its own', async () => {
      await server.callTool('register_job', { name: 'greet', description: 'Greets', script: 'return { v: 1 };' });

      const result = await server.callTool('update_job', { name: 'greet', script: 'return { v: 2 };', tags: ['v2'] });

      expect(result.structuredContent).toEqual({ success: true, jobId: 'greet' });
      const updated = entries().jobs.findByName('greet');
      expect((updated?.record as JobDynamicRecord).script).toBe('return { v: 2 };');
      expect(updated?.metadata).toEqual(expect.objectContaining({ description: 'Greets', tags: ['v2'] }));
    });

    it('updates a workflow registered at runtime, whose next run takes the new steps', async () => {
      await server.callTool('register_workflow', { name: 'nightly', steps: [{ id: 'step', jobName: 'step-only' }] });

      await server.callTool('update_workflow', { name: 'nightly', steps });
      const run = await server.callTool('execute_workflow', { name: 'nightly' });

      expect((run.structuredContent as { state: string }).state).toBe('completed');
      expect(ran).toEqual(['open']);
    });

    it('refuses to update an entry declared in code', async () => {
      await expect(server.callTool('update_job', { name: 'open', script: 'return {};' })).rejects.toThrow(
        new InvalidInputError('Job "open" is declared in code and cannot be updated'),
      );
      await expect(server.callTool('update_workflow', { name: 'ci-only', steps })).rejects.toThrow(
        new InvalidInputError('Workflow "ci-only" is declared in code and cannot be updated'),
      );
    });

    it("refuses a caller the entry's update rules deny as if the entry were unknown", async () => {
      const { jobs, workflows } = entries();
      jobs.registerDynamic({
        kind: JobKind.DYNAMIC,
        provide: 'guarded-job',
        metadata: {
          name: 'guarded-job',
          inputSchema: {},
          outputSchema: {},
          permissions: [{ action: 'update', roles: ['admin'] }],
        },
        script: 'return {};',
        registeredAt: Date.now(),
      });
      workflows.registerDynamic({
        kind: WorkflowKind.DYNAMIC,
        provide: 'guarded-flow',
        metadata: { name: 'guarded-flow', steps, permissions: [{ action: 'update', roles: ['admin'] }] },
        registeredAt: Date.now(),
      });
      const call = (tool: string, args: Record<string, unknown>, authContext: DirectAuthContext) =>
        server.callTool(tool, args, { authContext });

      await expect(call('update_job', { name: 'guarded-job', description: 'x' }, member)).rejects.toThrow(
        new JobNotAuthorizedError('guarded-job'),
      );
      await expect(call('update_job', { name: 'missing', description: 'x' }, member)).rejects.toThrow(
        new JobNotAuthorizedError('missing'),
      );
      await expect(call('update_workflow', { name: 'guarded-flow', steps }, member)).rejects.toThrow(
        new JobNotAuthorizedError('guarded-flow'),
      );
      await expect(call('update_job', { name: 'guarded-job', description: 'x' }, admin)).resolves.toEqual(
        expect.objectContaining({ structuredContent: { success: true, jobId: 'guarded-job' } }),
      );
      await expect(call('update_workflow', { name: 'guarded-flow', steps }, admin)).resolves.toEqual(
        expect.objectContaining({ structuredContent: { success: true, workflowId: 'guarded-flow' } }),
      );
    });
  });
});

describe('without jobs.allowDynamicRegistration', () => {
  it('serves no update_job or update_workflow', async () => {
    const server = await FrontMcpInstance.createDirect({ ...CONFIG, jobs: { enabled: true } });
    try {
      const { tools } = await server.listTools();
      const names = tools.map((tool) => tool.name);

      expect(names).not.toContain('update_job');
      expect(names).not.toContain('update_workflow');
    } finally {
      await server.dispose();
    }
  });
});
