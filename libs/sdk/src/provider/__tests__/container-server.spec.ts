/**
 * A server started on an existing container (#1356): `@FrontMcp({ container })` uses the instances the container
 * built, its server-level providers and its apps' own, instead of building them again. The first server that serves
 * readies them once, and their shutdown runs once neither the container nor a server on it holds them.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  App,
  Duty,
  FlowHooksOf,
  frontMcpMetadataSchema,
  LogLevel,
  Provider,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type FrontMcpConfigInput,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { ContainerDisposedError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { createContainer, type FrontMcpContainer } from '../create-container';

const phases: string[] = [];
let built = { settings: 0, ledger: 0, only: 0 };
const quiet = { level: LogLevel.Off, enableConsole: false };

@Provider({ name: 'settings' })
class Settings implements OnBootstrap, OnReady, OnShutdown {
  readonly id = Math.random();
  constructor() {
    built.settings++;
  }
  onBootstrap() {
    phases.push('bootstrap:settings');
  }
  onReady() {
    phases.push('ready:settings');
  }
  onShutdown() {
    phases.push('shutdown:settings');
  }
}

const audited: string[] = [];
const ToolHook = FlowHooksOf('tools:call-tool');

/** A server-level provider the server's config does not list: the server finds it on its container. */
@Provider({ name: 'only-in-container' })
class OnlyInContainer {
  constructor() {
    built.only++;
  }

  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    audited.push(String(ctx.state.tool?.name));
  }
}

let slowReadyDone = false;

/** A provider whose `onReady()` takes a while. */
@Provider({ name: 'slow-ready' })
class SlowReady implements OnReady {
  async onReady() {
    await new Promise((resolve) => setTimeout(resolve, 200));
    slowReadyDone = true;
  }
}

/** A provider of the server's own that depends on one the container built. */
@Provider({ name: 'settings-reader' })
class SettingsReader implements OnReady {
  constructor(readonly settings: Settings) {}
  onReady() {
    phases.push('ready:settings-reader');
  }
}

let finishSlowReady: (() => void) | undefined;

/** A container provider whose `onReady()` waits until the test lets it finish. */
@Provider({ name: 'held-ready' })
class HeldReady implements OnReady {
  async onReady() {
    await new Promise<void>((resolve) => (finishSlowReady = resolve));
  }
}

@Provider({ name: 'ledger' })
class Ledger implements OnBootstrap, OnShutdown {
  constructor(readonly settings: Settings) {
    built.ledger++;
  }
  onBootstrap() {
    phases.push('bootstrap:ledger');
  }
  onShutdown() {
    phases.push('shutdown:ledger');
  }
}

/** Answers which instances the tool sees, by their ids. */
@Tool({ name: 'instances', inputSchema: {} })
class InstancesTool extends ToolContext {
  async execute() {
    const ledger = this.get(Ledger);
    return {
      settings: this.get(Settings).id,
      ledgerSettings: ledger.settings.id,
      only: this.get(OnlyInContainer) instanceof OnlyInContainer,
    };
  }
}

@App({ name: 'Billing', providers: [Ledger], tools: [InstancesTool] })
class BillingApp {}

let dutyReady = 0;

@Duty({ name: 'sweep', every: '1h', scope: 'machine' })
class SweepDuty implements OnReady {
  async run() {
    return undefined;
  }
  onReady() {
    dutyReady++;
  }
}

@App({ name: 'Sweeper', providers: [SweepDuty] })
class SweeperApp {}

function serverConfig(container: FrontMcpContainer, overrides: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'on-container', version: '1.0.0' },
    apps: [BillingApp],
    providers: [Settings],
    logging: quiet,
    container,
    ...overrides,
  };
}

async function instancesOf(server: DirectMcpServer) {
  const answer = await server.callTool('instances', {});
  return answer.structuredContent as { settings: number; ledgerSettings: number; only: boolean };
}

describe('a server started on an existing container', () => {
  let home: string;
  let previousHome: string | undefined;
  const servers: DirectMcpServer[] = [];
  const containers: FrontMcpContainer[] = [];

  beforeEach(() => {
    phases.length = 0;
    audited.length = 0;
    slowReadyDone = false;
    finishSlowReady = undefined;
    built = { settings: 0, ledger: 0, only: 0 };
    dutyReady = 0;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-container-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.dispose().catch(() => undefined);
    for (const container of containers.splice(0)) await container.dispose().catch(() => undefined);
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function container(options: Parameters<typeof createContainer>[0] = {}): Promise<FrontMcpContainer> {
    const made = await createContainer({
      providers: [Settings, OnlyInContainer],
      apps: [BillingApp],
      logging: quiet,
      ...options,
    });
    containers.push(made);
    return made;
  }

  async function serve(config: FrontMcpConfigInput): Promise<DirectMcpServer> {
    const server = await FrontMcpInstance.createDirect(config);
    servers.push(server);
    return server;
  }

  it("uses the container's server-level and app instances, building none of them again", async () => {
    const made = await container();
    const server = await serve(serverConfig(made));

    expect(built).toEqual({ settings: 1, ledger: 1, only: 1 });
    expect(await instancesOf(server)).toEqual({
      settings: made.get(Settings).id,
      ledgerSettings: made.get(Settings).id,
      only: true,
    });
    expect(made.get(Ledger).settings).toBe(made.get(Settings));
  });

  it("runs the hooks of the container's server-level providers that the server's config does not list", async () => {
    const made = await container();
    const server = await serve(serverConfig(made));

    await instancesOf(server);
    expect(audited).toEqual(['instances']);
  });

  it('shares one container between two servers, and readies its providers once, in the first that serves', async () => {
    const made = await container();
    const first = await serve(serverConfig(made));
    const second = await serve(serverConfig(made));

    expect(await instancesOf(first)).toEqual(await instancesOf(second));
    expect(built).toEqual({ settings: 1, ledger: 1, only: 1 });
    expect(phases).toEqual(['bootstrap:settings', 'bootstrap:ledger', 'ready:settings']);
  });

  it("starts two servers on one container at once, each once the container's providers are ready", async () => {
    const made = await container({ providers: [Settings, OnlyInContainer, SlowReady] });
    const config = serverConfig(made, { providers: [Settings, SlowReady] });

    const readyAtStart = await Promise.all([
      serve(config).then(() => slowReadyDone),
      serve(config).then(() => slowReadyDone),
    ]);

    expect(readyAtStart).toEqual([true, true]);
    expect(phases.filter((phase) => phase === 'ready:settings')).toHaveLength(1);
  });

  it("readies the server's own providers after the container's providers they depend on", async () => {
    const made = await container();
    await serve(serverConfig(made, { providers: [Settings, SettingsReader] }));

    expect(phases.filter((phase) => phase.startsWith('ready:'))).toEqual(['ready:settings', 'ready:settings-reader']);
  });

  it("refuses a container disposed while its providers' onReady() ran for the server", async () => {
    const made = await container({ providers: [Settings, OnlyInContainer, HeldReady] });
    const starting = FrontMcpInstance.createDirect(serverConfig(made, { providers: [Settings, HeldReady] }));
    const refused = expect(starting).rejects.toBeInstanceOf(ContainerDisposedError);
    for (let tries = 0; !finishSlowReady && tries < 200; tries++)
      await new Promise((resolve) => setTimeout(resolve, 10));

    await made.dispose();
    containers.splice(containers.indexOf(made), 1);
    finishSlowReady?.();

    await refused;
  });

  it("leaves the container's providers running when a server on it shuts down; dispose() shuts them down once", async () => {
    const made = await container();
    const server = await serve(serverConfig(made));

    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    expect(phases).not.toContain('shutdown:settings');

    await made.dispose();
    containers.splice(containers.indexOf(made), 1);
    expect(phases.filter((phase) => phase.startsWith('shutdown:'))).toEqual(['shutdown:ledger', 'shutdown:settings']);
  });

  it('shuts them down with the last server when the container was disposed first', async () => {
    const made = await container();
    const server = await serve(serverConfig(made));

    await made.dispose();
    containers.splice(containers.indexOf(made), 1);
    expect(phases.filter((phase) => phase.startsWith('shutdown:'))).toEqual([]);

    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    expect(phases.filter((phase) => phase.startsWith('shutdown:')).sort()).toEqual([
      'shutdown:ledger',
      'shutdown:settings',
    ]);
  });

  it('refuses a disposed container', async () => {
    const made = await container();
    await made.dispose();
    containers.splice(containers.indexOf(made), 1);

    await expect(FrontMcpInstance.createDirect(serverConfig(made))).rejects.toBeInstanceOf(ContainerDisposedError);
  });

  it('refuses a container disposed while the server was building, and readies none of its providers', async () => {
    const made = await container();
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    // Built before the container's providers, and waits while the container is disposed
    const slow = { name: 'slow', provide: Symbol('slow'), useFactory: async () => gate.then(() => ({})) };
    const starting = FrontMcpInstance.createDirect(serverConfig(made, { providers: [slow, Settings] }));
    const refused = expect(starting).rejects.toBeInstanceOf(ContainerDisposedError);
    await new Promise((resolve) => setTimeout(resolve, 100));

    await made.dispose();
    containers.splice(containers.indexOf(made), 1);
    openGate();

    await refused;
    expect(phases).toContain('shutdown:settings');
    expect(phases).not.toContain('ready:settings');
  });

  it('starts the duties of a container that did not, once; and never again those of one that did', async () => {
    const idle = await container({ apps: [SweeperApp], providers: [], info: { name: 'on-container' } });
    await serve({
      info: { name: 'on-container', version: '1.0.0' },
      apps: [SweeperApp],
      logging: quiet,
      container: idle,
    });
    await serve({
      info: { name: 'on-container', version: '1.0.0' },
      apps: [SweeperApp],
      logging: quiet,
      container: idle,
    });
    expect(dutyReady).toBe(1);

    for (const server of servers.splice(0)) await server.dispose();
    for (const made of containers.splice(0)) await made.dispose();
    dutyReady = 0;
    const running = await container({
      apps: [SweeperApp],
      providers: [],
      info: { name: 'on-container' },
      runBackground: true,
    });
    expect(dutyReady).toBe(1);
    await serve({
      info: { name: 'on-container', version: '1.0.0' },
      apps: [SweeperApp],
      logging: quiet,
      container: running,
    });
    expect(dutyReady).toBe(1);
  });

  it('builds what the container did not: an app it was not given', async () => {
    const made = await container({ apps: [] });
    await serve(serverConfig(made));

    expect(built).toEqual({ settings: 1, ledger: 1, only: 1 });
    expect(phases.filter((phase) => phase === 'bootstrap:ledger')).toHaveLength(1);
  });

  it('refuses a value that is not a container', () => {
    expect(() =>
      frontMcpMetadataSchema.parse({
        info: { name: 'x', version: '1' },
        apps: [],
        container: { get: () => undefined },
      }),
    ).toThrow('container must be a container createContainer() made');
  });
});
