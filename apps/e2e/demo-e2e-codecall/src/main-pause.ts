import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import { CodeCallPlugin } from '@frontmcp/plugins';
import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';

import ActivitiesListTool from './apps/crm/tools/activities-list.tool';
import ActivitiesLogTool from './apps/crm/tools/activities-log.tool';
import ApprovalsGrantTool from './apps/crm/tools/approvals-grant.tool';
import UsersGetTool from './apps/crm/tools/users-get.tool';
import UsersOffboardTool from './apps/crm/tools/users-offboard.tool';

const port = parseInt(process.env['PORT'] ?? '3108', 10);

/** CodeCall with `review` on and runs that pause: a paused run waits 3 seconds for codecall:resume. */
@App({
  name: 'CRM',
  plugins: [
    CodeCallPlugin.init({
      mode: 'codecall_only',
      review: {},
      directCalls: { enabled: true },
      runs: { pause: { waitSeconds: 3 } },
    }),
    ApprovalPlugin.init({ storage: { type: 'memory' } }),
  ],
  tools: [ActivitiesLogTool, ActivitiesListTool, UsersGetTool, UsersOffboardTool, ApprovalsGrantTool],
})
class CrmWithPausedRunsApp {}

@FrontMcp({
  info: { name: 'Demo E2E CodeCall (pause and resume)', version: '0.1.0' },
  apps: [CrmWithPausedRunsApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
