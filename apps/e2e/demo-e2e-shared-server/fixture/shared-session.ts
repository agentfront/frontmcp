/**
 * A stdio session of a shared local server: it attaches to the server of key `e2e`, starting it when none runs. Its
 * name, version, attach budget, upgrade policy, idle time and checkout come from the environment. The server has a
 * Claude Code channel, `build-alerts`, which the `announce_build` tool sends an event on.
 *
 * `SHARED_SPARE` gives the session a spare. With `SHARED_PAGES` the server serves pages too: a plain route, people
 * sign-in and a page for signed-in people; with `SHARED_JOBS`, a detached job.
 */
import 'reflect-metadata';

import * as path from 'node:path';

import {
  App,
  Channel,
  ChannelContext,
  FrontMcpInstance,
  HttpRoute,
  HttpRouteContext,
  Job,
  JobContext,
  LogLevel,
  LoopbackTokenAuth,
  Tool,
  ToolContext,
  z,
  type FrontMcpConfigInput,
  type HttpOutput,
} from '@frontmcp/sdk';
import { appendFile } from '@frontmcp/utils';

const env = process.env;
const bootDelayMs = Number(env['SHARED_BOOT_DELAY_MS'] ?? 0);
const serverPidsFile = process.env['SHARED_SERVER_PIDS'];
if (process.env['FRONTMCP_SHARED_SERVE'] && serverPidsFile) void appendFile(serverPidsFile, `${process.pid}\n`);
/** Where each boot of the server is written, `<pid> <ms since the epoch>`, as it starts building its providers. */
const bootsFile = env['SHARED_BOOTS'];
const pages = env['SHARED_PAGES'] === '1';
const jobs = env['SHARED_JOBS'] === '1';

@Tool({ name: 'server_pid', description: 'The pid of the process that serves this session', inputSchema: {} })
class ServerPidTool extends ToolContext {
  async execute() {
    return { pid: process.pid };
  }
}

const BUILD_FINISHED = 'build:finished';

/** Tells Claude Code sessions that a build finished, and which server process says so. */
@Channel({
  name: 'build-alerts',
  description: 'Builds that finished',
  source: { type: 'app-event', event: BUILD_FINISHED },
})
class BuildAlertChannel extends ChannelContext {
  /** The notification of one finished build. */
  async onEvent(payload: unknown) {
    const { build } = payload as { build: string };
    return { content: `Build ${build} finished on server ${process.pid}`, meta: { build } };
  }
}

/** Emits the app event the `build-alerts` channel listens to. */
@Tool({
  name: 'announce_build',
  description: 'Tell every Claude Code session of this server that a build finished',
  inputSchema: { build: z.string() },
})
class AnnounceBuildTool extends ToolContext {
  /** Emit the event, and answer the build it names. */
  async execute(input: { build: string }) {
    this.scope.channelEventBus?.emit(BUILD_FINISHED, input);
    return { announced: input.build };
  }
}

/** A sign-in link for the person at the keyboard, as a tool hands one out. */
@Tool({ name: 'sign_in_link', description: 'A one-time sign-in link for the pages', inputSchema: {} })
class SignInLinkTool extends ToolContext {
  async execute() {
    const { code } = this.get(LoopbackTokenAuth).createCode();
    const loginPath = `/_frontmcp/people/login?code=${code}`;
    // The server's address as the session's request reached it: http://127.0.0.1:<port> on loopback HTTP
    return { loginPath, url: `${this.context.metadata.serverUrl ?? ''}${loginPath}` };
  }
}

/** A page only a signed-in person sees, naming the process that serves it. */
@HttpRoute({ method: 'GET', path: '/board', auth: 'people' })
class BoardRoute extends HttpRouteContext {
  handle(): HttpOutput {
    return { kind: 'text', status: 200, body: `board of ${process.pid}`, contentType: 'text/plain; charset=utf-8' };
  }
}

/** Runs in a process of its own, which outlives the server, and answers which one. */
@Job({
  name: 'runner-pid',
  description: 'Answers the pid of the process that runs it',
  inputSchema: {},
  outputSchema: { pid: z.number() },
  runner: 'detached',
  permissions: [{ action: 'read' }],
})
class RunnerPidJob extends JobContext {
  async execute() {
    return { pid: process.pid };
  }
}

@App({
  id: 'shared',
  name: 'Shared',
  tools: [ServerPidTool, AnnounceBuildTool, ...(pages ? [SignInLinkTool] : [])],
  channels: [BuildAlertChannel],
  routes: pages ? [BoardRoute] : [],
  jobs: jobs ? [RunnerPidJob] : [],
})
class SharedApp {}

@App({ id: 'public', name: 'Public', tools: [ServerPidTool], standalone: true, auth: { mode: 'public' } })
class PublicApp {}

const SlowBoot = Symbol('SlowBoot');

/** Write that this process boots the server, then take `SHARED_BOOT_DELAY_MS` to do it. */
async function bootSlowly(): Promise<void> {
  if (bootsFile) await appendFile(bootsFile, `${process.pid} ${Date.now()}\n`);
  await new Promise((resolve) => setTimeout(resolve, bootDelayMs));
}

const config: FrontMcpConfigInput = {
  info: { name: env['SHARED_APP_NAME'] ?? 'shared-e2e', version: env['SHARED_APP_VERSION'] ?? '1.0.0' },
  apps: process.env['SHARED_PUBLIC_APP'] ? [SharedApp, PublicApp] : [SharedApp],
  providers: bootDelayMs || bootsFile ? [{ name: 'slow-boot', provide: SlowBoot, useFactory: bootSlowly }] : [],
  logging: { level: LogLevel.Verbose },
  channels: { enabled: true },
  ...(pages
    ? {
        http: {
          entryPath: '/mcp',
          auth: { people: { mode: 'loopback-token', store: false } },
          routes: [
            {
              method: 'GET',
              path: '/plain',
              handler: (_request, response) => {
                response.status(200).json({ plain: true, pid: process.pid });
              },
            },
          ],
        },
      }
    : {}),
  ...(jobs
    ? { jobs: { enabled: true, store: { sqlite: { path: path.join(String(env['FRONTMCP_HOME']), 'jobs.sqlite') } } } }
    : {}),
};

FrontMcpInstance.runShared(config, {
  key: 'e2e',
  transport: env['SHARED_TRANSPORT'] === 'http' ? 'http' : 'unix',
  attachBudgetMs: Number(env['SHARED_ATTACH_BUDGET_MS'] ?? 60_000),
  replaceOlder: env['SHARED_REPLACE_OLDER'] !== '0',
  ...(env['SHARED_IDLE_TIMEOUT_MS'] ? { idleTimeoutMs: Number(env['SHARED_IDLE_TIMEOUT_MS']) } : {}),
  ...(env['SHARED_CHECKOUT'] ? { checkout: env['SHARED_CHECKOUT'] } : {}),
  spare: env['SHARED_SPARE'] === '1',
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
