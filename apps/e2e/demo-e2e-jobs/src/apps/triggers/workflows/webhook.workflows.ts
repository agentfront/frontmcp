import { z } from '@frontmcp/lazy-zod';
import { Workflow } from '@frontmcp/sdk';

/** Started by a signed POST to /hooks/deploy; its execute rule allows the webhook's role and nothing else. */
@Workflow({
  name: 'deploy-on-push',
  description: 'Records each push the deploy webhook receives',
  trigger: 'webhook',
  webhook: { path: '/hooks/deploy', secret: process.env['DEPLOY_WEBHOOK_SECRET'] },
  inputSchema: { ref: z.string(), pusher: z.string().optional() },
  permissions: [{ action: 'execute', roles: ['webhook:deploy-on-push'] }],
  steps: [{ id: 'record', jobName: 'record-delivery' }],
})
export class DeployOnPushWorkflow {}

/** A webhook whose workflow only admins may run: its requests are refused with 403. */
@Workflow({
  name: 'admin-release',
  trigger: 'webhook',
  webhook: { path: '/hooks/release', secret: process.env['RELEASE_WEBHOOK_SECRET'] },
  permissions: [{ action: 'execute', roles: ['admin'] }],
  steps: [{ id: 'record', jobName: 'record-delivery' }],
})
export class AdminReleaseWorkflow {}
