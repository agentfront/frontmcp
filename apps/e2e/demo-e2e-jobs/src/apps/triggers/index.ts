import { App } from '@frontmcp/sdk';

import { RecordDeliveryJob } from './jobs/record-delivery.job';
import { GetDeliveriesTool } from './tools/deliveries.tool';
import { SignUpTool } from './tools/sign-up.tool';
import { WelcomeOnSignupWorkflow } from './workflows/event.workflows';
import { HeartbeatOnScheduleWorkflow } from './workflows/schedule.workflows';
import { AdminReleaseWorkflow, DeployOnPushWorkflow } from './workflows/webhook.workflows';

/** Workflows a signed webhook, an event on the server or a schedule starts. */
@App({
  name: 'Triggers',
  description: 'Workflows started by their triggers',
  jobs: [RecordDeliveryJob],
  workflows: [DeployOnPushWorkflow, AdminReleaseWorkflow, WelcomeOnSignupWorkflow, HeartbeatOnScheduleWorkflow],
  tools: [GetDeliveriesTool, SignUpTool],
})
export class TriggersApp {}
