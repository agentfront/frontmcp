/**
 * A stdio session of a shared local server: it attaches to the server of key `e2e`, starting it when none runs. Its
 * name, version, attach budget, upgrade policy, idle time and checkout come from the environment.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { appendFile } from '@frontmcp/utils';

const env = process.env;
const bootDelayMs = Number(env['SHARED_BOOT_DELAY_MS'] ?? 0);
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
    info: { name: env['SHARED_APP_NAME'] ?? 'shared-e2e', version: env['SHARED_APP_VERSION'] ?? '1.0.0' },
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
  {
    key: 'e2e',
    transport: env['SHARED_TRANSPORT'] === 'http' ? 'http' : 'unix',
    attachBudgetMs: Number(env['SHARED_ATTACH_BUDGET_MS'] ?? 60_000),
    replaceOlder: env['SHARED_REPLACE_OLDER'] !== '0',
    ...(env['SHARED_IDLE_TIMEOUT_MS'] ? { idleTimeoutMs: Number(env['SHARED_IDLE_TIMEOUT_MS']) } : {}),
    ...(env['SHARED_CHECKOUT'] ? { checkout: env['SHARED_CHECKOUT'] } : {}),
  },
).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
