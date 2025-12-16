import { App } from '@frontmcp/sdk';
import { CodeCallPlugin } from '@frontmcp/plugins';

// User tools
import UsersListTool from './tools/users-list.tool';
import UsersGetTool from './tools/users-get.tool';
import UsersCreateTool from './tools/users-create.tool';
import UsersUpdateTool from './tools/users-update.tool';
import UsersDeleteTool from './tools/users-delete.tool';

// Activity tools
import ActivitiesListTool from './tools/activities-list.tool';
import ActivitiesLogTool from './tools/activities-log.tool';
import ActivitiesStatsTool from './tools/activities-stats.tool';

// Resource and prompt
import UsersResource from './resources/users.resource';
import AnalyzeUserActivityPrompt from './prompts/analyze-user-activity.prompt';

@App({
  name: 'CRM',
  description: 'CRM application with CodeCall plugin for E2E testing',
  plugins: [
    CodeCallPlugin.init({
      mode: 'codecall_only',
      topK: 10,
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
  ],
  resources: [UsersResource],
  prompts: [AnalyzeUserActivityPrompt],
})
export class CrmApp {}
