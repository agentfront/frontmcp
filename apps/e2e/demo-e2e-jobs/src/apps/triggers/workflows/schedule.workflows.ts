import { Workflow } from '@frontmcp/sdk';

/** Started at each second of its schedule; its execute rule allows the schedule's role and nothing else. */
@Workflow({
  name: 'heartbeat-on-schedule',
  description: 'Records a delivery at each scheduled time',
  trigger: 'schedule',
  schedule: { cron: '* * * * * *', input: { ref: 'scheduled' } },
  permissions: [{ action: 'execute', roles: ['schedule:heartbeat-on-schedule'] }],
  steps: [{ id: 'record', jobName: 'record-delivery' }],
})
export class HeartbeatOnScheduleWorkflow {}
