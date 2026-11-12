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
import type { BackgroundLifecycle } from '../provider/provider.lifecycle';
import type ProviderRegistry from '../provider/provider.registry';
import { loadCronSchedule, type CronSchedule } from './cron-schedule';
import { DutyRunner } from './duty.runner';
import { LazyLeaseStore } from './lazy-lease-store';
import {
  isLongLivedProcess,
  LeaseClaims,
  leaseKey,
  leaseStorageConfig,
  nameKey,
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

export class DutyLifecycle implements OnBootstrap, OnReady, OnShutdown, BackgroundLifecycle {
  private started?: Promise<StartedDuty | undefined>;
  /** Whether `stopBackground()` stopped the runs, so `resumeBackground()` starts them again. */
  private resumable = false;
  /** Whether `onShutdown()` was called, after which `resumeBackground()` starts nothing. */
  private shutDown = false;
  /** The last stop or start again, which the next one waits for. */
  private lastTurn: Promise<void> = Promise.resolve();
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

  /** Stop the runs and release the lease and claim, without the duty's own hooks. */
  async stopBackground(): Promise<void> {
    await this.inTurn(async () => {
      if (this.started) this.resumable = true;
      await this.stopRunner();
    });
  }

  /** Start again the runs `stopBackground()` stopped, once that stop ended. */
  async resumeBackground(): Promise<void> {
    await this.inTurn(async () => {
      if (!this.resumable || this.shutDown) return;
      this.resumable = false;
      this.started = this.startRunner();
      await this.started;
    });
  }

  async onShutdown(): Promise<void> {
    this.shutDown = true;
    await this.inTurn(() => this.stopRunner());
    await this.duty.onShutdown?.();
  }

  /** Run `step` once the stop or start before it ended, so a run never starts while the last one is still ending. */
  private inTurn(step: () => Promise<void>): Promise<void> {
    const turn = this.lastTurn.then(step);
    this.lastTurn = turn.catch(() => undefined);
    return turn;
  }

  /** Stop what the last start started, once, and give back the claim. */
  private async stopRunner(): Promise<void> {
    const starting = this.started;
    this.started = undefined;
    const started = await starting?.catch(() => undefined);
    if (started) {
      await started.runner.stop();
      await started.storage.disconnect();
      started.removeHealthProbe();
    }
    this.releaseClaim();
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
    this.claim(serverName);
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

  /** Take the duty's name in its server for its class: another class with it fails to start, whatever its scope. */
  private claim(serverName: string): void {
    const key = nameKey(this.metadata.name, serverName);
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
