import { App } from '@frontmcp/sdk';

import { RecordDeliveryJob } from './jobs/record-delivery.job';
import { GetDeliveriesTool } from './tools/deliveries.tool';
import { AdminReleaseWorkflow, DeployOnPushWorkflow } from './workflows/webhook.workflows';

/** Workflows a signed webhook starts. */
@App({
  name: 'Triggers',
  description: 'Workflows started by their triggers',
  jobs: [RecordDeliveryJob],
  workflows: [DeployOnPushWorkflow, AdminReleaseWorkflow],
  tools: [GetDeliveriesTool],
})
export class TriggersApp {}
