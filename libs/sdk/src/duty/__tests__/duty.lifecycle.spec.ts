import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createStorage, resetRuntimeContext } from '@frontmcp/utils';

import { App, Duty, LogLevel, redisOptionsSchema, type OnBootstrap, type OnReady, type OnShutdown } from '../../common';
import { findProjectRoot } from '../../common/types/options/sqlite/resolve';
import type { DirectMcpServer } from '../../direct';
import { DutyNameConflictError, UnsafeDutyStoreError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { createContainer, type FrontMcpContainer } from '../../provider/create-container';
import type { Scope } from '../../scope/scope.instance';
import { dutyStorageConfig } from '../duty.lifecycle';
import { openLeaseStore } from '../lease-store';

jest.mock('../../common/types/options/sqlite/resolve', () => {
  const actual = jest.requireActual('../../common/types/options/sqlite/resolve');
  return { ...actual, findProjectRoot: jest.fn(actual.findProjectRoot) };
});

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, createStorage: jest.fn(actual.createStorage) };
});

const { createStorage: openRealStorage } = jest.requireActual<typeof import('@frontmcp/utils')>('@frontmcp/utils');

const quiet = { level: LogLevel.Off, enableConsole: false };
const info = { name: 'duty-spec' };
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe;
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
  let servers: FrontMcpInstance[];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-duties-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    ran.length = 0;
    shutdowns.length = 0;
    open = [];
    servers = [];
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(open.map((opened) => opened.dispose()));
    await Promise.all(servers.map((server) => server.shutdown()));
    jest.mocked(createStorage).mockReset().mockImplementation(openRealStorage);
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function container(options: Parameters<typeof createContainer>[0]): Promise<FrontMcpContainer> {
    const built = await createContainer({ logging: quiet, ...options });
    open.push(built);
    return built;
  }

  /** Serve `app` with its providers ready, and read the `/readyz` check named `probe`. */
  async function serve(app: typeof SweeperApp): Promise<(probe: string) => Promise<unknown>> {
    const server = await FrontMcpInstance.createForGraph({
      info: { name: 'duty-spec', version: '1.0.0' },
      apps: [app],
      logging: quiet,
    });
    servers.push(server);
    await server.emitProvidersReady();
    const scope = server.getPrimaryScope() as Scope;
    return async (probe) => (await scope.healthService?.getReadyz())?.probes?.[probe];
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
    const built = await createContainer({
      providers: [label, settings, SweepDuty],
      runDuties: true,
      info,
      logging: quiet,
    });

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

  it("runs the duty's own onReady() before its first run in a container that runs duties", async () => {
    const phases: string[] = [];
    @Duty({ name: 'hooked-in-container', every: 100, scope: 'machine' })
    class HookedDuty implements OnReady {
      onReady(): void {
        phases.push('ready');
      }
      run(): void {
        phases.push('run');
      }
    }

    await container({ providers: [HookedDuty], runDuties: true, info });
    await until(() => phases.includes('run'));

    expect(phases[0]).toBe('ready');
  });

  it('shows a duty as unhealthy while its lease store cannot be opened, and runs it once a lease check opens it', async () => {
    @Duty({ name: 'late-store', every: 100, scope: 'machine', leaseMs: 1_000 })
    class LateStoreDuty {
      run(): void {
        ran.push(this);
      }
    }
    @App({ name: 'LateStore', providers: [LateStoreDuty] })
    class LateStoreApp {}
    let leaseStoreOpens = 0;
    jest.mocked(createStorage).mockImplementation(async (config) => {
      if (config?.prefix === 'frontmcp:duty:' && ++leaseStoreOpens === 1) throw new Error('database is locked');
      return openRealStorage(config);
    });

    const readiness = await serve(LateStoreApp);

    expect(await readiness('duty:late-store')).toEqual({
      status: 'unhealthy',
      details: { holdsLease: false },
      error: 'the lease store cannot be opened: database is locked',
    });
    expect(ran).toEqual([]);

    await until(() => ran.length >= 1);
    expect(await readiness('duty:late-store')).toEqual({ status: 'healthy', details: { holdsLease: true } });
    expect(leaseStoreOpens).toBe(2);
  });

  it('needs the server name to run duties in a container, since leases are per server name', async () => {
    await expect(createContainer({ providers: [SweepDuty], runDuties: true, logging: quiet })).rejects.toThrow(
      'runDuties needs info.name',
    );
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
  });

  it('refuses a second duty class that would share the lease of another in this process', async () => {
    @Duty({ name: 'shared', every: 100, scope: 'machine' })
    class FirstShared {
      run(): void {
        ran.push(this);
      }
    }
    @Duty({ name: 'shared', every: 100, scope: 'machine' })
    class SecondShared {
      run(): void {
        ran.push(this);
      }
    }

    const first = (await container({ providers: [FirstShared], runDuties: true, info })).get(FirstShared);
    const conflict = createContainer({ providers: [SecondShared], runDuties: true, info, logging: quiet });
    await expect(conflict).rejects.toBeInstanceOf(DutyNameConflictError);
    await expect(conflict).rejects.toThrow(
      'Duty "shared" of server "duty-spec" is declared by two classes in this process (FirstShared and SecondShared)',
    );
    const again = (await container({ providers: [FirstShared], runDuties: true, info })).get(FirstShared);
    await until(() => ran.includes(first) || ran.includes(again));
  });

  it('keeps the leases of names that contain colons apart', async () => {
    @Duty({ name: 'c', every: 100, scope: 'machine' })
    class NamedC {
      run(): void {
        ran.push(this);
      }
    }
    @Duty({ name: 'b:c', every: 100, scope: 'machine' })
    class NamedBC {
      run(): void {
        ran.push(this);
      }
    }

    const c = (await container({ providers: [NamedC], runDuties: true, info: { name: 'a:b' } })).get(NamedC);
    const bc = (await container({ providers: [NamedBC], runDuties: true, info: { name: 'a' } })).get(NamedBC);

    await until(() => ran.includes(c) && ran.includes(bc), 3_000);
  });

  it('opens no lease store when the project root cannot be read', async () => {
    jest.mocked(findProjectRoot).mockImplementationOnce(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    await expect(createContainer({ providers: [IndexDuty], runDuties: true, info, logging: quiet })).rejects.toThrow(
      'permission denied',
    );
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
  });

  it('does not start duties in a serverless deployment', async () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
    resetRuntimeContext();
    try {
      await container({ providers: [SweepDuty], runDuties: true, info });
      await sleep(300);
    } finally {
      delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
      resetRuntimeContext();
    }

    expect(ran).toEqual([]);
    expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
  });

  describeOnPosix('the lease file', () => {
    it('is created owner-only (0600) in a folder created owner-only (0700)', async () => {
      const parent = path.join(home, 'nested');
      const leaseHome = path.join(parent, 'home');
      process.env['FRONTMCP_HOME'] = leaseHome;
      await container({ providers: [SweepDuty], runDuties: true, info });

      expect(fs.statSync(parent).mode & 0o777).toBe(0o700);
      expect(fs.statSync(leaseHome).mode & 0o777).toBe(0o700);
      const files = fs.readdirSync(leaseHome);
      expect(files).toContain('duties.sqlite');
      for (const file of files) expect(fs.statSync(path.join(leaseHome, file)).mode & 0o777).toBe(0o600);
    });

    it.each([0o777, 0o1777, 0o770])(
      'is refused in a folder the group or others can write to (mode %o)',
      async (mode) => {
        fs.chmodSync(home, mode);
        const refusal = `Refusing to keep duty leases under ${home} (mode 0${mode.toString(8)}): the group or others can write to it`;

        const refused = openLeaseStore(dutyStorageConfig(undefined));
        await expect(refused).rejects.toBeInstanceOf(UnsafeDutyStoreError);
        await expect(refused).rejects.toThrow(refusal);
        const readiness = await serve(SweeperApp);
        await sleep(300);

        expect(await readiness('duty:SweepDuty')).toMatchObject({
          status: 'unhealthy',
          error: expect.stringContaining(`the lease store cannot be opened: ${refusal}`),
        });
        expect(ran).toEqual([]);
        expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
      },
    );
  });

  it('names the other user that owns a lease folder it refuses', () => {
    expect(new UnsafeDutyStoreError('/srv/shared', 0o40755, 501).message).toBe(
      'Refusing to keep duty leases under /srv/shared (mode 0755): it belongs to another user (uid 501). ' +
        'Set FRONTMCP_HOME to a folder only you can write to.',
    );
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
