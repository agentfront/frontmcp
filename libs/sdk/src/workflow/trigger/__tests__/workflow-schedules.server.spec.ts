/**
 * `trigger: 'schedule'` workflows in a server: checked when it starts, started once it serves, stopped when it is
 * disposed. The timing of the schedule itself is covered in workflow-schedules.spec.ts.
 */
import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { z } from '@frontmcp/lazy-zod';

import {
  App,
  Job,
  JobContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Workflow,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { WorkflowTriggerConfigError } from '../../../errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { type Scope } from '../../../scope/scope.instance';

const sent: Array<Record<string, unknown>> = [];
const warnings: string[] = [];

@LogTransport({ name: 'ScheduleWarnings', description: 'Keeps the warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Job({ name: 'send-digest', inputSchema: { audience: z.string().optional() }, outputSchema: {} })
class SendDigestJob extends JobContext {
  async execute(input: Record<string, unknown>) {
    sent.push(input);
    return {};
  }
}

@Workflow({
  name: 'digest',
  trigger: 'schedule',
  schedule: { cron: '* * * * * *', input: { audience: 'team' } },
  permissions: [{ action: 'execute', roles: ['admin', 'schedule:digest'] }],
  steps: [{ id: 'send', jobName: 'send-digest' }],
})
class DigestWorkflow {}

@Workflow({
  name: 'admin-digest',
  trigger: 'schedule',
  schedule: { cron: '* * * * * *', input: { audience: 'admins' } },
  permissions: [{ action: 'execute', roles: ['admin'] }],
  steps: [{ id: 'send', jobName: 'send-digest' }],
})
class AdminDigestWorkflow {}

@Workflow({
  name: 'weekly-digest',
  trigger: 'schedule',
  schedule: { cron: '0 9 * * 1', timezone: 'Europe/Berlin' },
  steps: [{ id: 'send', jobName: 'send-digest' }],
})
class WeeklyDigestWorkflow {}

@App({
  id: 'digests',
  name: 'Digests',
  jobs: [SendDigestJob],
  workflows: [DigestWorkflow, AdminDigestWorkflow, WeeklyDigestWorkflow],
})
class DigestsApp {}

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'workflow-schedules', version: '1.0.0' },
  apps: [DigestsApp],
  logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
};

async function until(condition: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function appWith(workflow: object): object {
  @App({ id: 'one', name: 'One', jobs: [SendDigestJob], workflows: [workflow as never] })
  class OneWorkflowApp {}
  return OneWorkflowApp;
}

describe('scheduled workflows in a server', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-workflow-schedules-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    sent.length = 0;
    warnings.length = 0;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('start a run at each scheduled time once the server serves, and none after it is disposed', async () => {
    const server: DirectMcpServer = await FrontMcpInstance.createDirect(CONFIG);
    try {
      await until(() => sent.length >= 2);
    } finally {
      await server.dispose();
    }
    const sentAtDispose = sent.length;
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent.slice(0, 2)).toEqual([{ audience: 'team' }, { audience: 'team' }]);
    expect(sent.length).toBe(sentAtDispose);
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(true);
  });

  it("start no run when the workflow's execute rules don't allow schedule:<workflow>, and say how to allow it", async () => {
    const server = await FrontMcpInstance.createDirect(CONFIG);
    try {
      await until(() => warnings.some((warning) => warning.includes('admin-digest')));
    } finally {
      await server.dispose();
    }

    expect(warnings).toContainEqual(
      'The schedule did not start workflow "admin-digest": its create or execute rules don\'t allow the role ' +
        '"schedule:admin-digest"; add it to their roles',
    );
    expect(sent).not.toContainEqual({ audience: 'admins' });
  });

  it('do not start in a server that is built but never serves', async () => {
    const instance = await FrontMcpInstance.createForGraph(CONFIG);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      expect(sent).toEqual([]);
      expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);

      await instance.emitProvidersReady();
      await until(() => sent.length >= 1);
    } finally {
      await instance.shutdown();
    }
  });

  it('start at once when the job system starts after the server serves, and stop when the workflow is withdrawn', async () => {
    @App({ id: 'plain', name: 'Plain' })
    class PlainApp {}
    const server = await FrontMcpInstance.createDirect({ ...CONFIG, apps: [PlainApp] });
    const scope = (server as unknown as { scope: Scope }).scope;
    try {
      const withdraw = await scope.serveAppJobs({
        jobs: [SendDigestJob],
        workflows: [DigestWorkflow],
        providers: scope.providers,
      });
      await until(() => sent.length >= 1);

      withdraw();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const sentWhenWithdrawn = sent.length;
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      expect(sent.length).toBe(sentWhenWithdrawn);
    } finally {
      await server.dispose();
    }
  });

  it('are listed with their trigger', async () => {
    const server = await FrontMcpInstance.createDirect(CONFIG);
    try {
      const listed = await server.callTool('list_workflows', {});

      expect(listed.structuredContent).toEqual({
        workflows: [{ name: 'weekly-digest', trigger: 'schedule', stepCount: 1, tags: [] }],
        count: 1,
      });
    } finally {
      await server.dispose();
    }
  });
});

describe('startup and registration of scheduled workflows', () => {
  it('refuses to start a server whose schedule cannot be read', async () => {
    @Workflow({
      name: 'broken',
      trigger: 'schedule',
      schedule: { cron: '61 * * * *' },
      steps: [{ id: 'send', jobName: 'send-digest' }],
    })
    class BrokenScheduleWorkflow {}

    await expect(
      FrontMcpInstance.createDirect({ ...CONFIG, apps: [appWith(BrokenScheduleWorkflow) as never] }),
    ).rejects.toThrow(
      new WorkflowTriggerConfigError(
        'broken',
        'schedule.cron "61 * * * *" can\'t be read: Invalid value for minute: 61',
      ).message,
    );
  });

  it('refuses a schedule trigger without a schedule', async () => {
    @Workflow({ name: 'unscheduled', trigger: 'schedule', steps: [{ id: 'send', jobName: 'send-digest' }] })
    class UnscheduledWorkflow {}

    await expect(
      FrontMcpInstance.createDirect({ ...CONFIG, apps: [appWith(UnscheduledWorkflow) as never] }),
    ).rejects.toThrow('Workflow "unscheduled": trigger: \'schedule\' needs schedule.cron');
  });

  it('refuses a schedule on a workflow whose trigger is not schedule', async () => {
    @Workflow({ name: 'stray', schedule: { cron: '0 9 * * *' }, steps: [{ id: 'send', jobName: 'send-digest' }] })
    class StrayScheduleWorkflow {}

    await expect(
      FrontMcpInstance.createDirect({ ...CONFIG, apps: [appWith(StrayScheduleWorkflow) as never] }),
    ).rejects.toThrow('Workflow "stray": schedule is set, but trigger is not \'schedule\'');
  });

  it("refuses trigger: 'schedule' on a workflow registered at runtime", async () => {
    @App({ id: 'dynamic', name: 'Dynamic', jobs: [SendDigestJob] })
    class DynamicApp {}
    const server = await FrontMcpInstance.createDirect({
      ...CONFIG,
      apps: [DynamicApp],
      jobs: { enabled: true, allowDynamicRegistration: true },
    });
    try {
      await expect(
        server.callTool('register_workflow', {
          name: 'nightly',
          trigger: 'schedule',
          steps: [{ id: 'send', jobName: 'send-digest' }],
        }),
      ).rejects.toThrow("A workflow registered at runtime can't have trigger: 'schedule'");
    } finally {
      await server.dispose();
    }
  });
});
