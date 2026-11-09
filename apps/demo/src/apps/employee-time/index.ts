import { CachePlugin } from '@frontmcp/plugins';
import { App } from '@frontmcp/sdk';

import SiteAuthorizationPlugin from './plugins/site-authorization.plugin';
import { createEmployeeDirectoryProvider } from './providers/employee-directory.provider';
import { createEmployeeRedisProvider } from './providers/redis.provider';
import AdminAddEntryTool from './tools/admin-add-entry.tool';
import AdminAddExitTool from './tools/admin-add-exit.tool';
import GetEmployeeDetailsTool from './tools/get-employee-details.tool';
import ListEmployeesTool from './tools/list-employees.tool';
import RegisterEntryTool from './tools/register-entry.tool';
import RegisterExitTool from './tools/register-exit.tool';

@App({
  id: 'employee-time',
  name: 'Employee Time MCP app',
  providers: [createEmployeeRedisProvider, createEmployeeDirectoryProvider],
  plugins: [
    SiteAuthorizationPlugin,
    CachePlugin.init({
      type: 'redis',
      config: { host: 'localhost', port: 6379 },
    }),
  ],
  tools: [
    RegisterEntryTool,
    RegisterExitTool,
    AdminAddEntryTool,
    AdminAddExitTool,
    GetEmployeeDetailsTool,
    ListEmployeesTool,
  ],
})
export default class EmployeeTimeMcpApp {}
