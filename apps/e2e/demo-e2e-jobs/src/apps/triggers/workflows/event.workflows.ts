import { z } from '@frontmcp/lazy-zod';
import { Workflow } from '@frontmcp/sdk';

/** Started when the server emits user.signup; its execute rule allows the event's role and nothing else. */
@Workflow({
  name: 'welcome-on-signup',
  description: 'Records each signup the server emits',
  trigger: 'event',
  event: 'user.signup',
  inputSchema: { email: z.string() },
  permissions: [{ action: 'execute', roles: ['event:user.signup'] }],
  steps: [{ id: 'record', jobName: 'record-delivery' }],
})
export class WelcomeOnSignupWorkflow {}
