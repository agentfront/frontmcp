import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createMemoryStorage, createStorage, resetRuntimeContext, type RootStorage } from '@frontmcp/utils';

import { App, Duty, LogLevel, redisOptionsSchema } from '../../common';
import { ClusterScopeNeedsRedisError, InvalidDutyCronError, ProviderBootstrapError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { createContainer, type FrontMcpContainer } from '../../provider/create-container';
import { dutyStorageConfig } from '../duty.lifecycle';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, createStorage: jest.fn(actual.createStorage) };
});

const quiet = { level: LogLevel.Off, enableConsole: false };
const info = { name: 'duty-spec' };
const redis = { url: 'redis://cache.internal:6379' };
const NEEDS_REDIS =
  'Duty "nightly-report" has scope \'cluster\', which keeps one lease for every machine in Redis, and none is ' +
  "configured: set a top-level redis (@FrontMcp({ redis }) or createContainer({ redis })), or use scope 'machine'";
const ran: object[] = [];

@Duty({ name: 'nightly-report', every: 100, scope: 'cluster' })
class ClusterDuty {
  run(): void {
    ran.push(this);
  }
}

@Duty({ name: 'sweep', every: 100, scope: 'machine' })
class MachineDuty {
  run(): void {
    ran.push(this);
  }
}

@Duty({ name: 'each-second', cron: '* * * * * *', scope: 'machine' })
class EachSecondDuty {
  run(): void {
    ran.push(this);
  }
}

@Duty({ name: 'bad-cron', cron: '61 * * * *', scope: 'machine' })
class BadCronDuty {
  run(): void {
    ran.push(this);
  }
}

@App({ name: 'Reports', providers: [ClusterDuty] })
class ReportsApp {}

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

async function bootstrapFailure(building: Promise<unknown>): Promise<ProviderBootstrapError> {
  const error = await building.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ProviderBootstrapError);
  return error as ProviderBootstrapError;
}

describe('cron and cluster duties in a server and in createContainer()', () => {
  let home: string;
  let previousHome: string | undefined;
  let open: FrontMcpContainer[];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-cron-duties-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    ran.length = 0;
    open = [];
  });

  afterEach(async () => {
    jest.mocked(createStorage).mockClear();
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

  /** Stand in for the server's Redis: the next `opens` lease stores the containers open are this one. */
  async function sharedStore(opens: number): Promise<RootStorage> {
    const store = createMemoryStorage();
    await store.connect();
    for (let open = 0; open < opens; open++) jest.mocked(createStorage).mockResolvedValueOnce(store);
    return store;
  }

  describe("scope: 'cluster'", () => {
    it('refuses to start a server that has no Redis, naming the duty and the fix', async () => {
      const starting = FrontMcpInstance.createDirect({
        info: { name: 'duty-spec', version: '1.0.0' },
        apps: [ReportsApp],
        logging: quiet,
      });

      await expect(starting).rejects.toThrow(NEEDS_REDIS);
      expect(ran).toEqual([]);
      expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
    });

    it('refuses a container that runs duties without Redis, as CLUSTER_SCOPE_NEEDS_REDIS', async () => {
      const failure = await bootstrapFailure(
        createContainer({ providers: [ClusterDuty], runDuties: true, info, logging: quiet }),
      );

      expect(failure.message).toBe(`Provider "ClusterDuty" failed in onBootstrap(): ${NEEDS_REDIS}`);
      expect(failure.originalError).toBeInstanceOf(ClusterScopeNeedsRedisError);
      expect((failure.originalError as ClusterScopeNeedsRedisError).code).toBe('CLUSTER_SCOPE_NEEDS_REDIS');
      expect(fs.existsSync(path.join(home, 'duties.sqlite'))).toBe(false);
    });

    it('refuses a store that is not Redis, such as Vercel KV', async () => {
      const failure = await bootstrapFailure(
        createContainer({
          providers: [ClusterDuty],
          runDuties: true,
          info,
          redis: { provider: 'vercel-kv' },
          logging: quiet,
        }),
      );

      expect(failure.originalError).toBeInstanceOf(ClusterScopeNeedsRedisError);
    });

    it('builds in a container that does not run duties, with or without Redis', async () => {
      const built = await container({ providers: [ClusterDuty] });

      expect(built.get(ClusterDuty)).toBeInstanceOf(ClusterDuty);
      await sleep(250);
      expect(ran).toEqual([]);
    });

    it('is not refused where duties never start, such as a serverless deployment', async () => {
      process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
      resetRuntimeContext();
      try {
        await container({ providers: [ClusterDuty], runDuties: true, info });
        await sleep(250);
      } finally {
        delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
        resetRuntimeContext();
      }

      expect(ran).toEqual([]);
    });

    it('is not refused in a server that a build boots only to read it', async () => {
      const read = await FrontMcpInstance.createForManifest({
        info: { name: 'duty-spec', version: '1.0.0' },
        apps: [ReportsApp],
        logging: quiet,
      });
      await read.shutdown();

      expect(ran).toEqual([]);
    });

    it('keeps one lease for every machine in Redis, and a machine lease per hostname', async () => {
      const store = await sharedStore(3);

      const first = (await container({ providers: [ClusterDuty], runDuties: true, info, redis })).get(ClusterDuty);
      const second = (await container({ providers: [ClusterDuty], runDuties: true, info, redis })).get(ClusterDuty);
      await container({ providers: [MachineDuty], runDuties: true, info, redis });
      await until(() => ran.includes(first));
      await sleep(300);

      expect(ran).not.toContain(second);
      expect(jest.mocked(createStorage).mock.calls.map(([config]) => [config?.type, config?.prefix])).toEqual([
        ['redis', 'frontmcp:cluster:duty:'],
        ['redis', 'frontmcp:cluster:duty:'],
        ['redis', `frontmcp:duty:${os.hostname()}:`],
      ]);
      expect(await store.get('duty-spec:nightly-report')).not.toBeNull();
    });

    it('has a Redis prefix without the hostname, unlike the other scopes', () => {
      const options = redisOptionsSchema.parse({ url: 'rediss://:secret@cache.internal:6380/2' });
      const connection = { config: { host: 'cache.internal', port: 6380, password: 'secret', db: 2, tls: true } };

      expect(dutyStorageConfig(options, 'cluster')).toEqual({
        type: 'redis',
        redis: connection,
        prefix: 'frontmcp:cluster:duty:',
        fallback: 'error',
      });
      for (const scope of ['machine', 'workspace'] as const) {
        expect(dutyStorageConfig(options, scope).prefix).toBe(`frontmcp:duty:${os.hostname()}:`);
      }
      expect(dutyStorageConfig(undefined, 'cluster').type).toBe('sqlite');
    });
  });

  describe('cron', () => {
    it('refuses to build a duty whose cron cannot be read, as INVALID_DUTY_CRON', async () => {
      const failure = await bootstrapFailure(createContainer({ providers: [BadCronDuty], logging: quiet }));

      expect(failure.message).toBe(
        'Provider "BadCronDuty" failed in onBootstrap(): Duty "bad-cron" has a cron expression that can\'t be read ' +
          '("61 * * * *"): Invalid value for minute: 61',
      );
      expect(failure.originalError).toBeInstanceOf(InvalidDutyCronError);
      expect((failure.originalError as InvalidDutyCronError).code).toBe('INVALID_DUTY_CRON');
    });

    it('runs a cron duty at its scheduled times, and stops it at dispose()', async () => {
      const built = await createContainer({ providers: [EachSecondDuty], runDuties: true, info, logging: quiet });

      await until(() => ran.length >= 2);
      await built.dispose();
      const runsAtDispose = ran.length;
      await sleep(1_200);

      expect(ran.length).toBe(runsAtDispose);
    });
  });
});
