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
  type DutyInterface,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
  type ResolvedDutyMetadata,
} from '../common';
import { findProjectRoot } from '../common/types/options/sqlite/resolve';
import { DutyNameConflictError, UnsafeDutyStoreError } from '../errors/duty.errors';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import type ProviderRegistry from '../provider/provider.registry';
import { findReplaceableDirectory } from '../server/security/replaceable-directory';
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
  const key = [serverName, name].map(encodeURIComponent).join(':');
  if (scope === 'machine') return key;
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

  private async startRunner(): Promise<StartedDuty | undefined> {
    const { name, everyMs, leaseMs } = this.metadata;
    const logger = this.providers.get(FrontMcpLogger);
    const { runtime, deployment } = getRuntimeContext();
    if (deployment === 'serverless' || runtime === 'edge' || runtime === 'browser') {
      logger.warn(`Duty "${name}" does not run in a serverless or edge deployment: it needs a long-lived process`);
      return undefined;
    }
    const config = this.providers.get(FrontMcpConfig);
    const serverName = config.info?.name ?? 'frontmcp';
    const key = leaseKey(this.metadata, serverName);
    this.claim(key, serverName);
    const storageConfig = dutyStorageConfig(config.redis);
    if (storageConfig.sqlite) await prepareLeaseFile(storageConfig.sqlite.path);
    const storage = await createStorage(storageConfig);
    const runner = new DutyRunner({
      name,
      everyMs,
      leaseMs,
      storage,
      logger,
      key,
      run: (context) => this.duty.run(context),
    });
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
