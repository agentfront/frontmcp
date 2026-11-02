/** A stdio session of a shared local server: it attaches to the server of key `e2e`, starting it when none runs. */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { appendFile } from '@frontmcp/utils';

const bootDelayMs = Number(process.env['SHARED_BOOT_DELAY_MS'] ?? 0);
const serverPidsFile = process.env['SHARED_SERVER_PIDS'];
if (process.env['FRONTMCP_SHARED_SERVE'] && serverPidsFile) void appendFile(serverPidsFile, `${process.pid}\n`);

@Tool({ name: 'server_pid', description: 'The pid of the process that serves this session', inputSchema: {} })
class ServerPidTool extends ToolContext {
  async execute() {
    return { pid: process.pid };
  }
}

@App({ id: 'shared', name: 'Shared', tools: [ServerPidTool] })
class SharedApp {}

@App({ id: 'public', name: 'Public', tools: [ServerPidTool], standalone: true, auth: { mode: 'public' } })
class PublicApp {}

const SlowBoot = Symbol('SlowBoot');

FrontMcpInstance.runShared(
  {
    info: { name: 'shared-e2e', version: '1.0.0' },
    apps: process.env['SHARED_PUBLIC_APP'] ? [SharedApp, PublicApp] : [SharedApp],
    providers: bootDelayMs
      ? [
          {
            name: 'slow-boot',
            provide: SlowBoot,
            useFactory: () => new Promise((resolve) => setTimeout(resolve, bootDelayMs)),
          },
        ]
      : [],
    logging: { level: LogLevel.Verbose },
  },
  { key: 'e2e', transport: process.env['SHARED_TRANSPORT'] === 'http' ? 'http' : 'unix' },
).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
