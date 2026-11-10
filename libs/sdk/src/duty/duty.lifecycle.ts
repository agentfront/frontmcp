import {
  createStorage,
  getEnv,
  getRuntimeContext,
  mkdir,
  realpath,
  sha256Hex,
  stat,
  writeFile,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import {
  FrontMcpLogger,
  isRedisProvider,
  redisOptionsSchema,
  type DutyCron,
  type DutyInterface,
  type DutyRunContext,
  type DutyScope,
  type FrontMcpConfigType,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
  type ResolvedDutyMetadata,
} from '../common';
import { findProjectRoot } from '../common/types/options/sqlite/resolve';
import {
  ClusterScopeNeedsRedisError,
  DutyNameConflictError,
  InvalidDutyCronError,
  UnsafeDutyStoreError,
} from '../errors/duty.errors';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import { isManifestMode } from '../front-mcp/manifest-mode.flag';
import type ProviderRegistry from '../provider/provider.registry';
import { findReplaceableDirectory } from '../server/security/replaceable-directory';
import { loadCronSchedule, type CronSchedule } from './cron-schedule';
import { DutyRunner } from './duty.runner';

type DutyInstance = DutyInterface & Partial<OnBootstrap & OnReady & OnShutdown>;

interface StartedDuty {
  runner: DutyRunner;
  storage: RootStorage;
}

const lifecycles = new WeakMap<object, DutyLifecycle>();

/** The duty class that holds each lease key in this process, and how many of its instances started. */
const claims = new Map<string, { type: unknown; typeName: string; instances: number }>();

const OWNER_ONLY_DIRECTORY = 0o700;
const OWNER_ONLY_FILE = 0o600;
const GROUP_OR_OTHER_WRITE = 0o022;

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

/** Start the duties built in `providers` as a server does once it serves: each one's own `onReady()`, then its runs. */
export async function startDuties(providers: ProviderRegistry): Promise<void> {
  for (const instance of providers.getAllSingletons().values()) {
    if (typeof instance === 'object' && instance !== null) await lifecycles.get(instance)?.onReady();
  }
}

/**
 * Where the leases live: the server's Redis when it has one, otherwise a SQLite file every process on the machine
 * opens. In Redis a lease is per hostname, except a `'cluster'` duty's, which every machine shares.
 */
export function dutyStorageConfig(redis: unknown, scope: DutyScope = 'machine'): StorageConfig {
  const parsed = redis === undefined ? undefined : redisOptionsSchema.safeParse(redis);
  if (parsed?.success && isRedisProvider(parsed.data)) {
    const { host, port, password, db, tls } = parsed.data;
    return {
      type: 'redis',
      redis: { config: { host, port, password, db, tls } },
      prefix: scope === 'cluster' ? 'frontmcp:cluster:duty:' : `frontmcp:duty:${nodeOs().hostname()}:`,
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

/** A duty needs a long-lived process: not a serverless function, the edge or a browser. */
function isLongLivedProcess(): boolean {
  const { runtime, deployment } = getRuntimeContext();
  return deployment !== 'serverless' && runtime !== 'edge' && runtime !== 'browser';
}

/**
 * A server starts its duties, unless a build boots it only to read it; a container starts them only when asked to
 * (`runDuties`), which it states in its config.
 */
function startsDuties(config: FrontMcpConfigType): boolean {
  return !isManifestMode(config) && (config as { runDuties?: boolean }).runDuties !== false;
}

/** One lease per server name and duty; a workspace duty's is also per project root. */
function leaseKey({ name, scope }: ResolvedDutyMetadata, serverName: string): string {
  const key = [serverName, name].map(encodeURIComponent).join(':');
  if (scope !== 'workspace') return key;
  const cwd = process.cwd();
  return `${key}:${sha256Hex(findProjectRoot(cwd) ?? cwd)}`;
}

/** Create the lease file and its folder owner-only, and refuse a folder (or one above it) another user can write to. */
async function prepareLeaseFile(file: string): Promise<void> {
  const directory = nodePath().dirname(file);
  await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  if (process.platform !== 'win32') {
    const realDirectory = await realpath(directory);
    const replaceable =
      (await findReplaceableDirectory(directory)) ??
      (realDirectory === directory ? undefined : await findReplaceableDirectory(realDirectory));
    if (replaceable) throw new UnsafeDutyStoreError(replaceable.directory, replaceable.mode, replaceable.ownerUid);
    const { mode } = await stat(realDirectory);
    if (mode & GROUP_OR_OTHER_WRITE) throw new UnsafeDutyStoreError(directory, mode);
  }
  await writeFile(file, '', { mode: OWNER_ONLY_FILE, flag: 'a' });
}

export class DutyLifecycle implements OnBootstrap, OnReady, OnShutdown {
  private started?: Promise<StartedDuty | undefined>;
  private claimedKey?: string;
  private cron?: Promise<CronSchedule>;

  constructor(
    private readonly duty: DutyInstance,
    private readonly metadata: ResolvedDutyMetadata,
    private readonly providers: ProviderRegistry,
  ) {}

  async onBootstrap(): Promise<void> {
    await this.refuseWhatCannotRun();
    await this.duty.onBootstrap?.();
  }

  async onReady(): Promise<void> {
    await this.duty.onReady?.();
    this.started ??= this.startRunner();
    await this.started;
  }

  async onShutdown(): Promise<void> {
    const started = await this.started?.catch(() => undefined);
    if (started) {
      await started.runner.stop();
      await started.storage.disconnect();
    }
    this.releaseClaim();
    await this.duty.onShutdown?.();
  }

  /**
   * Fail the startup for what no process could run: a cron expression that can't be read, and a cluster duty where
   * duties start without a Redis to keep its lease in.
   */
  private async refuseWhatCannotRun(): Promise<void> {
    const { name, cron, scope } = this.metadata;
    if (cron) await this.cronSchedule(cron);
    if (scope !== 'cluster' || !isLongLivedProcess()) return;
    const config = this.providers.get(FrontMcpConfig);
    if (startsDuties(config) && dutyStorageConfig(config.redis, scope).type !== 'redis') {
      throw new ClusterScopeNeedsRedisError(`Duty "${name}"`);
    }
  }

  /** The duty's cron, read once. */
  private cronSchedule(cron: DutyCron): Promise<CronSchedule> {
    this.cron ??= loadCronSchedule(cron).catch((error: Error) => {
      throw new InvalidDutyCronError(this.metadata.name, cron.expression, error.message);
    });
    return this.cron;
  }

  private async startRunner(): Promise<StartedDuty | undefined> {
    const { metadata } = this;
    const { name, leaseMs, scope } = metadata;
    const logger = this.providers.get(FrontMcpLogger);
    if (!isLongLivedProcess()) {
      logger.warn(`Duty "${name}" does not run in a serverless or edge deployment: it needs a long-lived process`);
      return undefined;
    }
    const config = this.providers.get(FrontMcpConfig);
    const serverName = config.info?.name ?? 'frontmcp';
    const key = leaseKey(metadata, serverName);
    this.claim(key, serverName);
    const storageConfig = dutyStorageConfig(config.redis, scope);
    if (storageConfig.sqlite) await prepareLeaseFile(storageConfig.sqlite.path);
    const storage = await createStorage(storageConfig);
    const run = (context: DutyRunContext) => this.duty.run(context);
    const common = { name, key, leaseMs, storage, logger, run };
    const runner = new DutyRunner(
      metadata.cron
        ? { ...common, cron: await this.cronSchedule(metadata.cron) }
        : { ...common, everyMs: metadata.everyMs },
    );
    await runner.start();
    return { runner, storage };
  }

  /** Take `key` for this duty's class in this process: another class with the same key would never run here. */
  private claim(key: string, serverName: string): void {
    const type = this.duty.constructor;
    const claim = claims.get(key);
    if (claim && claim.type !== type) {
      throw new DutyNameConflictError(this.metadata.name, serverName, claim.typeName, type.name);
    }
    claims.set(key, { type, typeName: type.name, instances: (claim?.instances ?? 0) + 1 });
    this.claimedKey = key;
  }

  private releaseClaim(): void {
    const key = this.claimedKey;
    this.claimedKey = undefined;
    const claim = key === undefined ? undefined : claims.get(key);
    if (key === undefined || !claim) return;
    claim.instances--;
    if (claim.instances === 0) claims.delete(key);
  }
}
