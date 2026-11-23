import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import { CodeCallPlugin } from '@frontmcp/plugins';
import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';

import ApprovalsGrantTool from './apps/crm/tools/approvals-grant.tool';
import RunsReadTool from './apps/crm/tools/runs-read.tool';
import UsersGetTool from './apps/crm/tools/users-get.tool';
import UsersListTool from './apps/crm/tools/users-list.tool';
import UsersOffboardTool from './apps/crm/tools/users-offboard.tool';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

/** CodeCall with `review` on, and the Approval plugin as the channel a person approves destructive calls through. */
@App({
  name: 'CRM',
  plugins: [
    CodeCallPlugin.init({ mode: 'codecall_only', review: {}, directCalls: { enabled: true } }),
    ApprovalPlugin.init({ storage: { type: 'memory' } }),
  ],
  tools: [UsersListTool, UsersGetTool, UsersOffboardTool, ApprovalsGrantTool, RunsReadTool],
})
class CrmWithReviewApp {}

@FrontMcp({
  info: { name: 'Demo E2E CodeCall (review)', version: '0.1.0' },
  apps: [CrmWithReviewApp],
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
