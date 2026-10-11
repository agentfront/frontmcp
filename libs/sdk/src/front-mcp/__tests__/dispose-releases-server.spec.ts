/**
 * A disposed server can be collected (#821): `dispose()` stops every interval the server started (the
 * provider registries' session cleanup, the in-memory auth stores, the task store's and the auth
 * layer's storage sweepers), and a `Plugin.init()` record keeps no reference to the server that
 * installed it.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, rm } from '@frontmcp/utils';

import { App, DynamicPlugin, Job, JobContext, LogLevel, Plugin, Tool, ToolContext, Workflow } from '../../common';
import { create } from '../../direct/create';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@Job({ name: 'count', inputSchema: {}, outputSchema: { counted: z.boolean() } })
class CountJob extends JobContext {
  async execute() {
    return { counted: true };
  }
}

@Workflow({ name: 'count-flow', steps: [{ id: 'count', jobName: 'count' }] })
class CountFlow {}

@Plugin({ name: 'counter' })
class CounterPlugin extends DynamicPlugin<{ start: number }> {
  constructor(readonly options: { start: number }) {
    super();
  }
}

type IntervalHandle = Parameters<typeof clearInterval>[0];

/** Where each interval started while `run` ran, for the ones still running when it returned. */
async function intervalsLeftRunning(run: () => Promise<void>): Promise<string[]> {
  const running = new Map<IntervalHandle, string>();
  const nativeSetInterval = globalThis.setInterval;
  const nativeClearInterval = globalThis.clearInterval;
  globalThis.setInterval = ((handler: () => void, ms?: number, ...args: unknown[]) => {
    const timer = nativeSetInterval(handler, ms, ...args);
    running.set(timer, (new Error().stack ?? '').split('\n').slice(2, 5).join(' <-'));
    return timer;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer?: IntervalHandle) => {
    running.delete(timer);
    nativeClearInterval(timer);
  }) as typeof clearInterval;
  try {
    await run();
  } finally {
    globalThis.setInterval = nativeSetInterval;
    globalThis.clearInterval = nativeClearInterval;
    for (const timer of running.keys()) nativeClearInterval(timer);
  }
  return [...running.values()];
}

async function serveHelpDesk(options: Record<string, unknown> = {}, plugins: unknown[] = []) {
  @App({ id: 'help-desk', name: 'Help Desk', tools: [PingTool], jobs: [CountJob], workflows: [CountFlow], plugins })
  class HelpDeskApp {}
  return FrontMcpInstance.createDirect({
    info: { name: 'help-desk', version: '1.0.0' },
    apps: [HelpDeskApp],
    logging: { level: LogLevel.Off },
    ...options,
  });
}

describe('dispose() releases the server (#821)', () => {
  it.each([
    ['a public server with an app plugin, jobs and a workflow', {}],
    ['a server in local auth mode (credential vault and secure store)', { auth: { mode: 'local' } }],
  ])('stops every interval started by %s', async (_label, options) => {
    const left = await intervalsLeftRunning(async () => {
      const server = await serveHelpDesk(options, [CounterPlugin.init({ start: 1 })]);
      await server.listTools();
      await server.callTool('execute_job', { name: 'count' });
      await server.dispose();
    });

    expect(left).toEqual([]);
  });

  it('stops the in-memory auth stores once persistent token storage replaces them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-dispose-'));
    let server: Awaited<ReturnType<typeof serveHelpDesk>> | undefined;
    try {
      const leftWhileServing = await intervalsLeftRunning(async () => {
        server = await serveHelpDesk({
          auth: { mode: 'local', tokenStorage: { sqlite: { path: path.join(directory, 'tokens.sqlite') } } },
        });
      });

      expect(
        leftWhileServing.filter((startedAt) => /federated-auth\.session|orchestrated-token\.store/.test(startedAt)),
      ).toEqual([]);
    } finally {
      await server?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops every interval a create() server started', async () => {
    const left = await intervalsLeftRunning(async () => {
      const server = await create({
        info: { name: 'help-desk', version: '1.0.0' },
        tools: [PingTool],
        logging: { level: LogLevel.Off },
      });
      await server.callTool('ping', {});
      await server.dispose();
    });

    expect(left).toEqual([]);
  });

  it("leaves no reference to the disposed server on a Plugin.init() record's instance", async () => {
    const record = CounterPlugin.init({ start: 1 });

    const first = await serveHelpDesk({}, [record]);
    await first.dispose();
    expect(Object.prototype.hasOwnProperty.call(record.useValue, 'get')).toBe(false);

    const second = await serveHelpDesk({}, [record]);
    await expect(second.listTools()).resolves.toEqual(expect.objectContaining({ tools: expect.any(Array) }));
    await second.dispose();
    expect(Object.prototype.hasOwnProperty.call(record.useValue, 'get')).toBe(false);
  });
});
