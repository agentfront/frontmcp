/**
 * A `trigger: 'event'` workflow starts a background run when the scope's event bus emits its event, with the payload
 * as input, as the role `event:<event>`; the bus is the one `app-event` channel sources listen on.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  App,
  Channel,
  ChannelContext,
  Job,
  JobContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Workflow,
  type ChannelNotification,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { WorkflowTriggerConfigError } from '../../../errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { jobExecutionManagerOf } from '../../../job/job-run-access';
import { type Scope } from '../../../scope/scope.instance';

const recorded: Array<{ job: string; input: Record<string, unknown> }> = [];
const heardByChannel: unknown[] = [];
const warnings: string[] = [];

@LogTransport({ name: 'EventWarnings', description: 'Keeps the warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Job({ name: 'welcome', inputSchema: { email: z.string().optional() }, outputSchema: {} })
class WelcomeJob extends JobContext {
  async execute(input: Record<string, unknown>) {
    recorded.push({ job: 'welcome', input });
    return {};
  }
}

@Job({ name: 'audit', inputSchema: {}, outputSchema: {} })
class AuditJob extends JobContext {
  async execute() {
    recorded.push({ job: 'audit', input: {} });
    return {};
  }
}

@Workflow({
  name: 'onboard',
  trigger: 'event',
  event: 'user.signup',
  inputSchema: { email: z.string() },
  permissions: [{ action: 'execute', roles: ['admin', 'event:user.signup'] }],
  steps: [{ id: 'welcome', jobName: 'welcome' }],
})
class OnboardWorkflow {}

@Workflow({ name: 'audit-signup', trigger: 'event', event: 'user.signup', steps: [{ id: 'audit', jobName: 'audit' }] })
class AuditSignupWorkflow {}

@Workflow({ name: 'nightly-cleanup', trigger: 'event', steps: [{ id: 'audit', jobName: 'audit' }] })
class NightlyCleanupWorkflow {}

@Workflow({
  name: 'admin-report',
  trigger: 'event',
  permissions: [{ action: 'execute', roles: ['admin'] }],
  steps: [{ id: 'audit', jobName: 'audit' }],
})
class AdminReportWorkflow {}

@Channel({
  name: 'signups',
  description: 'Signups as they happen',
  source: { type: 'app-event', event: 'user.signup' },
})
class SignupChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    heardByChannel.push(payload);
    return { content: 'signup' };
  }
}

@App({
  id: 'events',
  name: 'Events',
  jobs: [WelcomeJob, AuditJob],
  workflows: [OnboardWorkflow, AuditSignupWorkflow, NightlyCleanupWorkflow, AdminReportWorkflow],
  channels: [SignupChannel],
})
class EventsApp {}

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'workflow-events', version: '1.0.0' },
  apps: [EventsApp],
  logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
};

describe('workflow events', () => {
  let server: DirectMcpServer;
  let scope: Scope;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({ ...CONFIG, channels: { enabled: true } });
    scope = (server as unknown as { scope: Scope }).scope;
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    recorded.length = 0;
    heardByChannel.length = 0;
    warnings.length = 0;
  });

  async function runsSettled(): Promise<Array<{ jobName: string; state: string; input?: unknown }>> {
    const manager = jobExecutionManagerOf(scope);
    const deadline = Date.now() + 5_000;
    for (;;) {
      const runs = (await manager?.listRuns()) ?? [];
      if (runs.every((run) => !['pending', 'running'].includes(run.state))) return runs;
      if (Date.now() > deadline) throw new Error('the runs did not end');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function emitted(event: string, payload?: unknown) {
    const before = ((await jobExecutionManagerOf(scope)?.listRuns()) ?? []).length;
    scope.channelEventBus?.emit(event, payload);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const runs = await runsSettled();
    return runs.slice(0, runs.length - before);
  }

  it('starts each workflow on the event, with the payload as input, and the channel on the same bus hears it', async () => {
    const runs = await emitted('user.signup', { email: 'ada@example.com' });

    expect(runs.map((run) => [run.jobName, run.state]).sort()).toEqual([
      ['audit-signup', 'completed'],
      ['onboard', 'completed'],
    ]);
    expect(recorded).toContainEqual({ job: 'welcome', input: { email: 'ada@example.com' } });
    expect(heardByChannel).toEqual([{ email: 'ada@example.com' }]);
  });

  it("listens to the workflow's name when it sets no event, and starts it with {} for no payload", async () => {
    const runs = await emitted('nightly-cleanup');

    expect(runs).toEqual([expect.objectContaining({ jobName: 'nightly-cleanup', state: 'completed', input: {} })]);
  });

  it("starts no run when the workflow's execute rules don't allow event:<event>, and says how to allow it", async () => {
    expect(await emitted('admin-report', {})).toEqual([]);
    expect(warnings).toContainEqual(
      'Event "admin-report" did not start workflow "admin-report": its create or execute rules don\'t allow the ' +
        'role "event:admin-report"; add it to their roles',
    );
  });

  it("starts no run for a payload that doesn't match the inputSchema, or isn't an object", async () => {
    const runs = [...(await emitted('user.signup', { email: 7 })), ...(await emitted('user.signup', 'ada'))];

    expect(runs.map((run) => run.jobName)).toEqual(['audit-signup']);
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'Event "user.signup" did not start workflow "onboard": Invalid input for workflow "onboard"',
      ),
    );
    expect(warnings).toContainEqual(
      'Event "user.signup" did not start workflow "onboard": its payload is not an object, which the run takes as its input',
    );
  });

  it('ignores an event no workflow listens to', async () => {
    expect(await emitted('user.deleted', {})).toEqual([]);
  });
});

describe('workflow events without channels', () => {
  it('get an event bus of their own', async () => {
    const server = await FrontMcpInstance.createDirect(CONFIG);
    try {
      const scope = (server as unknown as { scope: Scope }).scope;
      expect(scope.channelEventBus).toBeDefined();
      scope.channelEventBus?.emit('nightly-cleanup', {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(recorded).toContainEqual({ job: 'audit', input: {} });
    } finally {
      await server.dispose();
    }
  });

  it('leave a server without event workflows or channels with no bus', async () => {
    @App({ id: 'quiet', name: 'Quiet', jobs: [AuditJob] })
    class QuietApp {}
    const server = await FrontMcpInstance.createDirect({ ...CONFIG, apps: [QuietApp] });
    try {
      expect((server as unknown as { scope: Scope }).scope.channelEventBus).toBeUndefined();
    } finally {
      await server.dispose();
    }
  });
});

describe('startup and registration', () => {
  it('refuses an event on a workflow whose trigger is not event', async () => {
    @Workflow({ name: 'stray', event: 'user.signup', steps: [{ id: 'audit', jobName: 'audit' }] })
    class StrayEventWorkflow {}
    @App({ id: 'stray', name: 'Stray', jobs: [AuditJob], workflows: [StrayEventWorkflow] })
    class StrayApp {}

    await expect(FrontMcpInstance.createDirect({ ...CONFIG, apps: [StrayApp] })).rejects.toThrow(
      new WorkflowTriggerConfigError(
        'stray',
        "event is set, but trigger is not 'event': set trigger: 'event' to listen to it, or remove event",
      ).message,
    );
  });

  it("refuses trigger: 'event' on a workflow registered at runtime", async () => {
    @App({ id: 'dynamic', name: 'Dynamic', jobs: [AuditJob] })
    class DynamicApp {}
    const server = await FrontMcpInstance.createDirect({
      ...CONFIG,
      apps: [DynamicApp],
      jobs: { enabled: true, allowDynamicRegistration: true },
    });
    try {
      await expect(
        server.callTool('register_workflow', {
          name: 'on-signup',
          trigger: 'event',
          steps: [{ id: 'audit', jobName: 'audit' }],
        }),
      ).rejects.toThrow("A workflow registered at runtime can't have trigger: 'event'");
    } finally {
      await server.dispose();
    }
  });
});
