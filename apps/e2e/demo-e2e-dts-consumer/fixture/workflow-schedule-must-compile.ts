import 'reflect-metadata';

import {
  App,
  Job,
  JobContext,
  Workflow,
  WorkflowTriggerPrincipal,
  type WorkflowScheduleConfig,
  type WorkflowTriggerType,
} from '@frontmcp/sdk';

@Job({ name: 'send-digest', inputSchema: {}, outputSchema: {} })
export class SendDigestJob extends JobContext {
  async execute() {
    return {};
  }
}

const weekdays: WorkflowScheduleConfig = {
  cron: '0 9 * * 1-5',
  timezone: 'Europe/Berlin',
  input: { audience: 'team' },
};
const trigger: WorkflowTriggerType = 'schedule';

@Workflow({
  name: 'weekday-digest',
  trigger,
  schedule: weekdays,
  permissions: [{ action: 'execute', roles: ['admin', 'schedule:weekday-digest'] }],
  steps: [{ id: 'send', jobName: 'send-digest' }],
})
export class WeekdayDigestWorkflow {}

@Workflow({
  name: 'every-minute',
  trigger: 'schedule',
  schedule: { cron: '* * * * *' },
  steps: [{ id: 'send', jobName: 'send-digest' }],
})
export class EveryMinuteWorkflow {}

@App({ name: 'digests', jobs: [SendDigestJob], workflows: [WeekdayDigestWorkflow, EveryMinuteWorkflow] })
export class DigestsApp {}

export const scheduleRole: string = new WorkflowTriggerPrincipal('schedule', 'weekday-digest').role;

export class InvalidSchedules {
  // @ts-expect-error a schedule needs its cron
  static readonly noCron: WorkflowScheduleConfig = { timezone: 'UTC' };
  // @ts-expect-error cron is a string
  static readonly cron: WorkflowScheduleConfig = { cron: 60_000 };
  // @ts-expect-error the input of a scheduled run is an object
  static readonly input: WorkflowScheduleConfig = { cron: '* * * * *', input: 'team' };
  // @ts-expect-error trigger is 'manual', 'webhook', 'event' or 'schedule'
  static readonly trigger: WorkflowTriggerType = 'cron';
}
