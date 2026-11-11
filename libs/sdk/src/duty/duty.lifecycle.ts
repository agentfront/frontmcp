import { type StorageConfig } from '@frontmcp/utils';

import {
  FrontMcpLogger,
  type DutyCron,
  type DutyInterface,
  type DutyRunContext,
  type DutyScope,
  type HealthProbeResult,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
  type ResolvedDutyMetadata,
} from '../common';
import { ClusterScopeNeedsRedisError, DutyNameConflictError, InvalidDutyCronError } from '../errors/duty.errors';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import type ProviderRegistry from '../provider/provider.registry';
import { loadCronSchedule, type CronSchedule } from './cron-schedule';
import { DutyRunner } from './duty.runner';
import { LazyLeaseStore } from './lazy-lease-store';
import {
  isLongLivedProcess,
  LeaseClaims,
  leaseKey,
  leaseStorageConfig,
  registerReadinessProbe,
  startsBackgroundWork,
} from './lease-store';

type DutyInstance = DutyInterface & Partial<OnBootstrap & OnReady & OnShutdown>;

interface StartedDuty {
  runner: DutyRunner;
  storage: LazyLeaseStore;
  removeHealthProbe: () => void;
}

const lifecycles = new WeakMap<object, DutyLifecycle>();
const claims = new LeaseClaims();

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

/** Where the leases of duties live (see `leaseStorageConfig`). */
export function dutyStorageConfig(redis: unknown, scope: DutyScope = 'machine'): StorageConfig {
  return leaseStorageConfig(redis, 'duty', scope);
}

/** What `/readyz` shows for a duty: whether this process holds its lease, unhealthy while its store cannot be opened. */
export function dutyHealth(holdsLease: boolean, leaseStoreFailure?: string): HealthProbeResult {
  const details = { holdsLease };
  if (leaseStoreFailure === undefined) return { status: 'healthy', details };
  return { status: 'unhealthy', details, error: `the lease store cannot be opened: ${leaseStoreFailure}` };
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
      started.removeHealthProbe();
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
    if (startsBackgroundWork(config) && dutyStorageConfig(config.redis, scope).type !== 'redis') {
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

  /**
   * Contend for the duty's lease and run it while this process holds it. Its health check is in place before the lease
   * store is first opened, which each lease check tries until it opens.
   */
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
    const key = leaseKey(name, scope, serverName);
    this.claim(key, serverName);
    const storage = new LazyLeaseStore(dutyStorageConfig(config.redis, scope));
    const run = (context: DutyRunContext) => this.duty.run(context);
    const common = { name, key, leaseMs, storage, logger, run };
    const runner = new DutyRunner(
      metadata.cron
        ? { ...common, cron: await this.cronSchedule(metadata.cron) }
        : { ...common, everyMs: metadata.everyMs },
    );
    const removeHealthProbe = registerReadinessProbe(this.providers, {
      name: `duty:${name}`,
      check: async () => dutyHealth(runner.holdsLease, storage.openFailure),
    });
    await runner.start();
    return { runner, storage, removeHealthProbe };
  }

  /** Take `key` for this duty's class in this process: another class with the same key would never run here. */
  private claim(key: string, serverName: string): void {
    const type = this.duty.constructor;
    const otherClass = claims.claim(key, type);
    if (otherClass !== undefined) {
      throw new DutyNameConflictError(this.metadata.name, serverName, otherClass, type.name);
    }
    this.claimedKey = key;
  }

  private releaseClaim(): void {
    const key = this.claimedKey;
    this.claimedKey = undefined;
    if (key !== undefined) claims.release(key);
  }
}
