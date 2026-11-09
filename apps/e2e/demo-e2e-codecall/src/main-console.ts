import { CodeCallPlugin } from '@frontmcp/plugins';
import {
  App,
  FrontMcp,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  type LogRecord,
  type ServerRequest,
  type ServerResponse,
} from '@frontmcp/sdk';

import UsersListTool from './apps/crm/tools/users-list.tool';

const port = parseInt(process.env['PORT'] ?? '3106', 10);

/** The lines scripts wrote through `console`, for the test to read. */
const scriptConsoleLines: Array<{ level: string; message: string }> = [];

@LogTransport({ name: 'ScriptConsoleLines', description: 'Keeps the CodeCall:script lines for the e2e test' })
class ScriptConsoleLines extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.prefix.includes('CodeCall:script'))
      scriptConsoleLines.push({ level: record.levelName, message: record.message });
  }
}

/** CodeCall with `vm.allowConsole: true`: scripts' console calls go to the server's logger. */
@App({
  name: 'CRM',
  plugins: [CodeCallPlugin.init({ mode: 'codecall_only', vm: { allowConsole: true } })],
  tools: [UsersListTool],
})
class CrmWithConsoleApp {}

@FrontMcp({
  info: { name: 'Demo E2E CodeCall (console)', version: '0.1.0' },
  apps: [CrmWithConsoleApp],
  logging: { level: LogLevel.Info, transports: [ScriptConsoleLines] },
  http: {
    port,
    routes: [
      {
        method: 'GET',
        path: '/test/script-console',
        handler: (_req: ServerRequest, res: ServerResponse) => {
          res.status(200).json(scriptConsoleLines);
        },
      },
    ],
  },
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
