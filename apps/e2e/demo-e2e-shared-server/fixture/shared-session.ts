/** A stdio session of a shared local server: it attaches to the server of key `e2e`, starting it when none runs. */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'server_pid', description: 'The pid of the process that serves this session', inputSchema: {} })
class ServerPidTool extends ToolContext {
  async execute() {
    return { pid: process.pid };
  }
}

@App({ id: 'shared', name: 'Shared', tools: [ServerPidTool] })
class SharedApp {}

FrontMcpInstance.runShared(
  { info: { name: 'shared-e2e', version: '1.0.0' }, apps: [SharedApp], logging: { level: LogLevel.Verbose } },
  { key: 'e2e', transport: process.env['SHARED_TRANSPORT'] === 'http' ? 'http' : 'unix' },
).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
