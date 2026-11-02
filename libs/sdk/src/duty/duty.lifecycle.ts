import {
  createStorage,
  ensureDir,
  getEnv,
  getRuntimeContext,
  sha256Hex,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import {
  FrontMcpLogger,
  isRedisProvider,
  redisOptionsSchema,
  type DutyInterface,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
  type ResolvedDutyMetadata,
} from '../common';
import { findProjectRoot } from '../common/types/options/sqlite/resolve';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import type ProviderRegistry from '../provider/provider.registry';
import { DutyRunner } from './duty.runner';

type DutyInstance = DutyInterface & Partial<OnBootstrap & OnReady & OnShutdown>;

interface StartedDuty {
  runner: DutyRunner;
  storage: RootStorage;
}

const lifecycles = new WeakMap<object, DutyLifecycle>();

/** Node's `os` and `path`, loaded on first use: duties are Node-only and a browser bundle must not import them. */
function nodeOs(): typeof import('os') {
  return require('os');
}

function nodePath(): typeof import('path') {
  return require('path');
}

/** The lifecycle the provider registry runs for a `@Duty` instance: its own hooks, plus starting and stopping it. */
export function dutyLifecycleOf(
  duty: object,
  metadata: ResolvedDutyMetadata,
  providers: ProviderRegistry,
): DutyLifecycle {
  let lifecycle = lifecycles.get(duty);
  if (!lifecycle) {
    lifecycle = new DutyLifecycle(duty as DutyInstance, metadata, providers);
    lifecycles.set(duty, lifecycle);
  }
  return lifecycle;
}

/** Start the duties built in `providers`, as a server does once it serves. */
export async function startDuties(providers: ProviderRegistry): Promise<void> {
  for (const instance of providers.getAllSingletons().values()) {
    if (typeof instance === 'object' && instance !== null) await lifecycles.get(instance)?.start();
  }
}

/** Where the leases live: the server's Redis when it has one, otherwise a SQLite file every process on the machine opens. */
export function dutyStorageConfig(redis: unknown): StorageConfig {
  const parsed = redis === undefined ? undefined : redisOptionsSchema.safeParse(redis);
  if (parsed?.success && isRedisProvider(parsed.data)) {
    const { host, port, password, db, tls } = parsed.data;
    return {
      type: 'redis',
      redis: { config: { host, port, password, db, tls } },
      prefix: `frontmcp:duty:${nodeOs().hostname()}:`,
      fallback: 'error',
    };
  }
  const home = getEnv('FRONTMCP_HOME') || nodePath().join(nodeOs().homedir(), '.frontmcp');
  return {
    type: 'sqlite',
    sqlite: { path: nodePath().join(home, 'duties.sqlite') },
    prefix: 'frontmcp:duty:',
    fallback: 'error',
  };
}

/** One lease per server name and duty; a workspace duty's is also per project root. */
function leaseKey({ name, scope }: ResolvedDutyMetadata, serverName: string): string {
  const key = `${serverName}:${name}`;
  if (scope === 'machine') return key;
  const cwd = process.cwd();
  return `${key}:${sha256Hex(findProjectRoot(cwd) ?? cwd)}`;
}

export class DutyLifecycle implements OnBootstrap, OnReady, OnShutdown {
  private started?: Promise<StartedDuty | undefined>;

  constructor(
    private readonly duty: DutyInstance,
    private readonly metadata: ResolvedDutyMetadata,
    private readonly providers: ProviderRegistry,
  ) {}

  async onBootstrap(): Promise<void> {
    await this.duty.onBootstrap?.();
  }

  async onReady(): Promise<void> {
    await this.duty.onReady?.();
    await this.start();
  }

  async onShutdown(): Promise<void> {
    const started = await this.started?.catch(() => undefined);
    if (started) {
      await started.runner.stop();
      await started.storage.disconnect();
    }
    await this.duty.onShutdown?.();
  }

  async start(): Promise<void> {
    this.started ??= this.startRunner();
    await this.started;
  }

  private async startRunner(): Promise<StartedDuty | undefined> {
    const { name, everyMs, leaseMs } = this.metadata;
    const logger = this.providers.get(FrontMcpLogger);
    const { runtime, deployment } = getRuntimeContext();
    if (deployment === 'serverless' || runtime === 'edge' || runtime === 'browser') {
      logger.warn(`Duty "${name}" does not run in a serverless or edge deployment: it needs a long-lived process`);
      return undefined;
    }
    const config = this.providers.get(FrontMcpConfig);
    const storageConfig = dutyStorageConfig(config.redis);
    if (storageConfig.sqlite) await ensureDir(nodePath().dirname(storageConfig.sqlite.path));
    const storage = await createStorage(storageConfig);
    const runner = new DutyRunner({
      name,
      everyMs,
      leaseMs,
      storage,
      logger,
      key: leaseKey(this.metadata, config.info?.name ?? 'frontmcp'),
      run: (context) => this.duty.run(context),
    });
    await runner.start();
    return { runner, storage };
  }
}
