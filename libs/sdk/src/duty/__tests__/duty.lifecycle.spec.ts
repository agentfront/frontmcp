import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resetRuntimeContext } from '@frontmcp/utils';

import { App, Duty, LogLevel, redisOptionsSchema, type OnBootstrap, type OnReady, type OnShutdown } from '../../common';
import type { DirectMcpServer } from '../../direct';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { createContainer, type FrontMcpContainer } from '../../provider/create-container';
import { dutyStorageConfig } from '../duty.lifecycle';

const quiet = { level: LogLevel.Off, enableConsole: false };
const ran: object[] = [];
const shutdowns: string[] = [];

@Duty({ every: 100, scope: 'machine' })
class SweepDuty implements OnShutdown {
  run(): void {
    ran.push(this);
  }
  onShutdown(): void {
    shutdowns.push('sweep');
  }
}

@Duty({ name: 'index-project', every: 100, scope: 'workspace' })
class IndexDuty {
  run(): void {
    ran.push(this);
  }
}

@App({ name: 'Sweeper', providers: [SweepDuty] })
class SweeperApp {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(20);
  }
}

describe('duties in a server and in createContainer()', () => {
  let home: string;
  let previousHome: string | undefined;
  let open: Array<FrontMcpContainer | DirectMcpServer>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-duties-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    ran.length = 0;
    shutdowns.length = 0;
    open = [];
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(open.map((opened) => opened.dispose()));
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function container(options: Parameters<typeof createContainer>[0]): Promise<FrontMcpContainer> {
    const built = await createContainer({ logging: quiet, ...options });
    open.push(built);
    return built;
  }

  it('builds a duty in createContainer() without starting it, and still runs its own onShutdown()', async () => {
    const built = await createContainer({ providers: [SweepDuty], logging: quiet });

    expect(built.get(SweepDuty)).toBeInstanceOf(SweepDuty);
    await sleep(300);
    expect(ran).toEqual([]);
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);

    await built.dispose();
    expect(shutdowns).toEqual(['sweep']);
  });

  it('starts the duties of a container that asks with runDuties, and stops them at dispose()', async () => {
    const label = { name: 'label', provide: Symbol('label'), useValue: 'nightly' };
    const settings = { name: 'settings', provide: Symbol('settings'), useValue: { region: 'eu' } };
    const built = await createContainer({ providers: [label, settings, SweepDuty], runDuties: true, logging: quiet });

    await until(() => ran.length >= 2);
    await built.dispose();
    const runsAtDispose = ran.length;
    await sleep(300);

    expect(ran.length).toBe(runsAtDispose);
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(true);
    expect(shutdowns).toEqual(['sweep']);
  });

  it('runs a machine duty in one of two servers, and the other takes it over when the first shuts down', async () => {
    const config = { info: { name: 'duty-spec', version: '1.0.0' }, apps: [SweeperApp], logging: quiet };
    const first = await FrontMcpInstance.createDirect(config);
    open.push(first);
    await until(() => ran.length >= 1);
    const second = await FrontMcpInstance.createDirect(config);
    open.push(second);

    await sleep(400);
    expect(new Set(ran).size).toBe(1);
    const firstHolder = ran[0];

    await first.dispose();
    await until(() => ran.some((duty) => duty !== firstHolder));
    const afterTakeover = new Set(ran.slice(ran.findIndex((duty) => duty !== firstHolder)));
    expect(afterTakeover.has(firstHolder)).toBe(false);
  });

  it("keeps the duty's own hooks: onBootstrap() once built, onReady() before its first run", async () => {
    const phases: string[] = [];
    @Duty({ every: 100, scope: 'machine' })
    class HookedDuty implements OnBootstrap, OnReady {
      onBootstrap(): void {
        phases.push('bootstrap');
      }
      onReady(): void {
        phases.push('ready');
      }
      run(): void {
        phases.push('run');
      }
    }
    @App({ name: 'Hooked', providers: [HookedDuty] })
    class HookedApp {}

    const server = await FrontMcpInstance.createDirect({
      info: { name: 'duty-spec', version: '1.0.0' },
      apps: [HookedApp],
      logging: quiet,
    });
    open.push(server);
    await until(() => phases.includes('run'));

    expect(phases.slice(0, 3)).toEqual(['bootstrap', 'ready', 'run']);
  });

  it('keys a workspace duty by its project root, and every lease by the server name', async () => {
    const rootA = fs.mkdtempSync(path.join(home, 'project-a-'));
    const rootB = fs.mkdtempSync(path.join(home, 'project-b-'));
    fs.writeFileSync(path.join(rootA, 'package.json'), '{}');
    fs.writeFileSync(path.join(rootB, 'package.json'), '{}');
    const cwd = jest.spyOn(process, 'cwd');
    const inProject = async (dir: string, name = 'duty-spec') => {
      cwd.mockReturnValue(dir);
      return (await container({ providers: [IndexDuty], runDuties: true, info: { name } })).get(IndexDuty);
    };

    const inA = await inProject(rootA);
    const inB = await inProject(rootB);
    const inASubdirectory = await inProject(path.join(rootA, 'src'));
    const otherServerInA = await inProject(rootA, 'other-server');
    await until(() => [inA, inB, otherServerInA].every((duty) => ran.includes(duty)));
    await sleep(300);

    expect(ran).not.toContain(inASubdirectory);
  });

  it('does not start duties in a serverless deployment', async () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
    resetRuntimeContext();
    try {
      await container({ providers: [SweepDuty], runDuties: true });
      await sleep(300);
    } finally {
      delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
      resetRuntimeContext();
    }

    expect(ran).toEqual([]);
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
  });

  it("keeps leases in the server's Redis when one is configured, and in the machine's SQLite file otherwise", () => {
    const redis = redisOptionsSchema.parse({ url: 'rediss://:secret@cache.internal:6380/2' });
    expect(dutyStorageConfig(redis)).toEqual({
      type: 'redis',
      redis: { config: { host: 'cache.internal', port: 6380, password: 'secret', db: 2, tls: true } },
      prefix: `frontmcp:duty:${os.hostname()}:`,
      fallback: 'error',
    });

    const sqlite = {
      type: 'sqlite',
      sqlite: { path: path.join(home, 'duties.sqlite') },
      prefix: 'frontmcp:duty:',
      fallback: 'error',
    };
    expect(dutyStorageConfig(undefined)).toEqual(sqlite);
    expect(dutyStorageConfig(redisOptionsSchema.parse({ provider: 'vercel-kv' }))).toEqual(sqlite);

    expect(dutyStorageConfig({ url: 'redis://cache.internal:6379' })).toMatchObject({
      type: 'redis',
      redis: { config: { host: 'cache.internal', port: 6379, db: 0, tls: false } },
    });

    delete process.env['FRONTMCP_HOME'];
    expect(dutyStorageConfig(undefined).sqlite?.path).toBe(path.join(os.homedir(), '.frontmcp', 'duties.sqlite'));
  });
});
