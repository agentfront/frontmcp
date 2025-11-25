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

@App({
  id: 'crm',
  name: 'CRM Demo with CodeCall',
  description: 'A demo CRM application showcasing CodeCall plugin for AgentScript-based tool orchestration',
  providers: [],
  plugins: [
    // CodeCall plugin enables AgentScript-based tool orchestration
    // Default mode is 'codecall_only' - tools are only accessible via CodeCall
    // Uses TF-IDF for tool search (lightweight, no ML required)
    // VM preset 'secure' provides safe execution environment
    CodeCallPlugin.init({
      topK: 10, // Return up to 10 tools in search results
    }),
  ],
  tools: [
    // User management tools
    UsersListTool,
    UsersGetTool,
    UsersCreateTool,
    UsersUpdateTool,
    UsersDeleteTool,
    // Activity tracking tools
    ActivitiesListTool,
    ActivitiesLogTool,
    ActivitiesStatsTool,
  ],
})
export default class CrmMcpApp {}
