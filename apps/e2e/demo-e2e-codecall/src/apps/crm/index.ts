import { CodeCallPlugin } from '@frontmcp/plugins';
import { App } from '@frontmcp/sdk';

import AnalyzeUserActivityPrompt from './prompts/analyze-user-activity.prompt';
import UsersResource from './resources/users.resource';
import ActivitiesListTool from './tools/activities-list.tool';
import ActivitiesLogTool from './tools/activities-log.tool';
import ActivitiesStatsTool from './tools/activities-stats.tool';
import AdminPurgeUsersTool from './tools/admin-purge-users.tool';
import CrmResetTool from './tools/crm-reset.tool';
import SystemWipeConfigTool from './tools/system-wipe-config.tool';
import UsersCreateTool from './tools/users-create.tool';
import UsersDeleteTool from './tools/users-delete.tool';
import UsersExportTool from './tools/users-export.tool';
import UsersGetTool from './tools/users-get.tool';
import UsersListTool from './tools/users-list.tool';
import UsersUpdateTool from './tools/users-update.tool';

@App({
  name: 'CRM',
  description: 'CRM application with CodeCall plugin for E2E testing',
  plugins: [
    CodeCallPlugin.init({
      mode: 'codecall_only',
      topK: 10,
      includeTools: (tool) => !tool.name.startsWith('admin:'),
      directCalls: { enabled: true, allowedTools: ['users-list', 'users-get'] },
    }),
  ],
  tools: [
    UsersListTool,
    UsersGetTool,
    UsersCreateTool,
    UsersUpdateTool,
    UsersDeleteTool,
    ActivitiesListTool,
    ActivitiesLogTool,
    ActivitiesStatsTool,
    CrmResetTool,
    // Withheld by the CodeCall access policy (GHSA-6w3j-82v5-6qrr)
    AdminPurgeUsersTool,
    SystemWipeConfigTool,
    UsersExportTool,
  ],
  resources: [UsersResource],
  prompts: [AnalyzeUserActivityPrompt],
})
export class CrmApp {}
