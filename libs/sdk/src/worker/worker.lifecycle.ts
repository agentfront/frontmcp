import {
  FrontMcpLogger,
  type HealthProbeResult,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
  type ResolvedWorkerMetadata,
  type WorkerInterface,
} from '../common';
import { LazyLeaseStore } from '../duty/lazy-lease-store';
import { LeaseHolder } from '../duty/lease-holder';
import {
  isLongLivedProcess,
  LeaseClaims,
  leaseKey,
  leaseStorageConfig,
  registerReadinessProbe,
  startsBackgroundWork,
  type LeaseScope,
} from '../duty/lease-store';
import { ClusterScopeNeedsRedisError } from '../errors/duty.errors';
import { WorkerNameConflictError } from '../errors/worker.errors';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import type { BackgroundLifecycle } from '../provider/provider.lifecycle';
import type ProviderRegistry from '../provider/provider.registry';
import { WorkerSupervisor, type WorkerStatus } from './worker.supervisor';

type WorkerInstance = WorkerInterface & Partial<OnBootstrap & OnReady & OnShutdown>;

interface StartedLease {
  holder: LeaseHolder;
  storage: LazyLeaseStore;
}

interface StartedWorker {
  supervisor: WorkerSupervisor;
  lease?: StartedLease;
  removeHealthProbe: () => void;
}

const lifecycles = new WeakMap<object, WorkerLifecycle>();
const claims = new LeaseClaims();

/** The lifecycle the provider registry runs for a `@Worker` instance: its own hooks, plus starting and stopping it. */
export function workerLifecycleOf(
  worker: object,
  metadata: ResolvedWorkerMetadata,
  providers: ProviderRegistry,
): WorkerLifecycle {
  let lifecycle = lifecycles.get(worker);
  if (!lifecycle) {
    lifecycle = new WorkerLifecycle(worker as WorkerInstance, metadata, providers);
    lifecycles.set(worker, lifecycle);
  }
  return lifecycle;
}

/** Start the workers built in `providers` as a server does once it serves: each one's own `onReady()`, then its run. */
export async function startWorkers(providers: ProviderRegistry): Promise<void> {
  for (const instance of providers.getAllSingletons().values()) {
    if (typeof instance === 'object' && instance !== null) await lifecycles.get(instance)?.onReady();
  }
}

/**
 * What `/readyz` shows for a worker: unhealthy while its lease store cannot be opened or once it ended on an error for
 * good, degraded between two runs.
 */
export function workerHealth(status: WorkerStatus, leaseStoreFailure?: string): HealthProbeResult {
  const { state, lastError } = status;
  if (leaseStoreFailure !== undefined) {
    const error = `the lease store cannot be opened: ${leaseStoreFailure}`;
    return { status: 'unhealthy', details: { ...status }, error };
  }
  if (state === 'restarting') return { status: 'degraded', details: { ...status }, error: lastError };
  if (state === 'stopped' && lastError !== undefined) {
    return { status: 'unhealthy', details: { ...status }, error: lastError };
  }
  return { status: 'healthy', details: { ...status } };
}

/** Runs a `@Worker` instance's own lifecycle hooks, and starts and stops its supervised run around them. */
export class WorkerLifecycle implements OnBootstrap, OnReady, OnShutdown, BackgroundLifecycle {
  private started?: Promise<StartedWorker | undefined>;
  /** Whether `stopBackground()` stopped the run, so `resumeBackground()` starts it again. */
  private resumable = false;
  private claimedKey?: string;

  /** Takes the worker instance, its resolved metadata and the providers it was built with. */
  constructor(
    private readonly worker: WorkerInstance,
    private readonly metadata: ResolvedWorkerMetadata,
    private readonly providers: ProviderRegistry,
  ) {}

  /** Refuse a cluster worker without Redis, then run the worker's own `onBootstrap()`. */
  async onBootstrap(): Promise<void> {
    this.refuseClusterWithoutRedis();
    await this.worker.onBootstrap?.();
  }

  /** Run the worker's own `onReady()`, then start it once. */
  async onReady(): Promise<void> {
    await this.worker.onReady?.();
    this.started ??= this.start();
    await this.started;
  }

  /** Stop the run and release its lease and claim, without the worker's own hooks. */
  async stopBackground(): Promise<void> {
    if (this.started) this.resumable = true;
    await this.stopStarted();
  }

  /** Start again the run `stopBackground()` stopped. */
  async resumeBackground(): Promise<void> {
    if (!this.resumable) return;
    this.resumable = false;
    this.started = this.start();
    await this.started;
  }

  /** Stop the run and release its lease and claim, then run the worker's own `onShutdown()`. */
  async onShutdown(): Promise<void> {
    this.resumable = false;
    await this.stopStarted();
    await this.worker.onShutdown?.();
  }

  /** Stop what the last start started, once, and give back the claim. */
  private async stopStarted(): Promise<void> {
    const starting = this.started;
    this.started = undefined;
    const started = await starting?.catch(() => undefined);
    if (started) await this.stop(started);
    this.releaseClaim();
  }

  /** Fail the startup of a cluster worker where workers start without a Redis to keep its lease in. */
  private refuseClusterWithoutRedis(): void {
    const { name, scope } = this.metadata;
    if (scope !== 'cluster' || !isLongLivedProcess()) return;
    const config = this.providers.get(FrontMcpConfig);
    if (startsBackgroundWork(config) && leaseStorageConfig(config.redis, 'worker', scope).type !== 'redis') {
      throw new ClusterScopeNeedsRedisError(`Worker "${name}"`);
    }
  }

  /** Supervise the run, at once or under a lease per its scope; only in a long-lived process. */
  private async start(): Promise<StartedWorker | undefined> {
    const { name, restart, scope } = this.metadata;
    const logger = this.providers.get(FrontMcpLogger);
    if (!isLongLivedProcess()) {
      logger.warn(`Worker "${name}" does not run in a serverless or edge deployment: it needs a long-lived process`);
      return undefined;
    }
    const supervisor = new WorkerSupervisor({ name, restart, logger, run: (context) => this.worker.run(context) });
    if (scope !== 'process') return this.contend(supervisor, scope, logger);
    logger.info(`Worker "${name}" runs in this process`);
    supervisor.start();
    return { supervisor, removeHealthProbe: this.registerHealthProbe(supervisor) };
  }

  /**
   * Contend for the worker's lease: it runs while this process holds it, and its signal aborts when the lease is lost.
   * Its health check is in place before the lease store is first opened, which each lease check tries until it opens.
   */
  private async contend(
    supervisor: WorkerSupervisor,
    scope: LeaseScope,
    logger: FrontMcpLogger,
  ): Promise<StartedWorker> {
    const { name, leaseMs } = this.metadata;
    const config = this.providers.get(FrontMcpConfig);
    const serverName = config.info?.name ?? 'frontmcp';
    const key = leaseKey(name, scope, serverName);
    this.claim(key, serverName);
    const storage = new LazyLeaseStore(leaseStorageConfig(config.redis, 'worker', scope));
    const removeHealthProbe = this.registerHealthProbe(supervisor, storage);
    const holder = new LeaseHolder({
      label: `Worker "${name}"`,
      key,
      leaseMs,
      storage,
      logger,
      onAcquired: () => {
        logger.info(`Worker "${name}" runs in this process`);
        supervisor.start();
      },
      onLost: () => supervisor.abort(),
    });
    await holder.start();
    return { supervisor, lease: { holder, storage }, removeHealthProbe };
  }

  /** Abort the run and wait for it, a leased worker still renewing its lease meanwhile, then release the lease. */
  private async stop({ supervisor, lease, removeHealthProbe }: StartedWorker): Promise<void> {
    if (lease) {
      await lease.holder.stop(() => supervisor.stop());
      await lease.storage.disconnect();
    } else {
      await supervisor.stop();
    }
    removeHealthProbe();
  }

  /** Take `key` for this worker's class in this process: another class with the same key would never run here. */
  private claim(key: string, serverName: string): void {
    const type = this.worker.constructor;
    const otherClass = claims.claim(key, type);
    if (otherClass !== undefined) {
      throw new WorkerNameConflictError(this.metadata.name, serverName, otherClass, type.name);
    }
    this.claimedKey = key;
  }

  /** Give back this worker's claim on its lease key, if it took one. */
  private releaseClaim(): void {
    const key = this.claimedKey;
    this.claimedKey = undefined;
    if (key !== undefined) claims.release(key);
  }

  /** Show the worker in `/readyz` as `worker:<name>`; a container has no health checks to add it to. */
  private registerHealthProbe(supervisor: WorkerSupervisor, storage?: LazyLeaseStore): () => void {
    return registerReadinessProbe(this.providers, {
      name: `worker:${this.metadata.name}`,
      check: async () => workerHealth(supervisor.status(), storage?.openFailure),
    });
  }
}
