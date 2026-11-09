import { App } from '@frontmcp/sdk';

import { RecordDeliveryJob } from './jobs/record-delivery.job';
import { GetDeliveriesTool } from './tools/deliveries.tool';
import { SignUpTool } from './tools/sign-up.tool';
import { WelcomeOnSignupWorkflow } from './workflows/event.workflows';
import { AdminReleaseWorkflow, DeployOnPushWorkflow } from './workflows/webhook.workflows';

/** Workflows a signed webhook or an event on the server starts. */
@App({
  name: 'Triggers',
  description: 'Workflows started by their triggers',
  jobs: [RecordDeliveryJob],
  workflows: [DeployOnPushWorkflow, AdminReleaseWorkflow, WelcomeOnSignupWorkflow],
  tools: [GetDeliveriesTool, SignUpTool],
})
export class TriggersApp {}
