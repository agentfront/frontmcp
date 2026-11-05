import type { AuthoritiesContextBuilder, AuthoritiesEngine, AuthoritiesScopeMapping } from '@frontmcp/auth';
import type { Token, Type } from '@frontmcp/di';
import type { GuardManager } from '@frontmcp/guard';
import type { EventStore } from '@frontmcp/protocol';

import type AgentRegistry from '../../agent/agent.registry';
import type AppRegistry from '../../app/app.registry';
import type { AuthUiRegistry } from '../../auth/auth-ui';
import type { AuthRegistry } from '../../auth/auth.registry';
import type { ChannelNotificationService } from '../../channel/channel-notification.service';
import type ChannelRegistry from '../../channel/channel.registry';
import type { ChannelEventBus } from '../../channel/sources/app-event.source';
import type { PersistentQuestions } from '../../elicitation/questions/question-scope.helper';
import type { ElicitationStore } from '../../elicitation/store/elicitation.store';
import type { HaManager } from '../../ha';
import type HookRegistry from '../../hooks/hook.registry';
import type { HttpRouteTable } from '../../http-route/http-route.table';
import type JobRegistry from '../../job/job.registry';
import type { NotificationService } from '../../notification';
import type { EnforcedMetadataScope } from '../../plugin/enforced-metadata.check';
import type PromptRegistry from '../../prompt/prompt.registry';
import type ResourceRegistry from '../../resource/resource.registry';
import type { SkillSessionManager } from '../../skill/session/skill-session.manager';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import { runListChangeBatch, type ListChangeBatch } from '../../surface/list-change-batch';
import type { LiveSurface } from '../../surface/live-surface';
import type { TaskStore } from '../../task/store/task.store';
import type { TaskRegistry } from '../../task/task.registry';
import type ToolRegistry from '../../tool/tool.registry';
import type { ToolUIRegistry } from '../../tool/ui/ui-shared';
import type { TransportService } from '../../transport/transport.registry';
import type WorkflowRegistry from '../../workflow/workflow.registry';
import type {
  FlowInputOf,
  FlowOutputOf,
  FlowType,
  FrontMcpAuth,
  FrontMcpLogger,
  PluginRegistryInterface,
  ProviderRegistryInterface,
} from '../interfaces';
import type { FlowName, ScopeMetadata } from '../metadata';
import type { ScopeRecord } from '../records';
import type { HealthProbeDefinition } from '../types/options/health';
import { normalizeEntryPrefix, normalizeScopeBase } from '../utils';
import { BaseEntry } from './base.entry';

/** The registries of an app loaded after startup. */
export type LateAppRegistries = Omit<EnforcedMetadataScope, 'hooks'>;

export abstract class ScopeEntry extends BaseEntry<ScopeRecord, unknown, ScopeMetadata> {
  abstract readonly id: string;
  abstract readonly entryPath: string;
  abstract readonly routeBase: string;
  abstract readonly logger: FrontMcpLogger;

  get fullPath(): string {
    const prefix = normalizeEntryPrefix(this.entryPath ?? '');
    const scope = normalizeScopeBase(this.routeBase ?? '');
    return `${prefix}${scope}`;
  }

  abstract get auth(): FrontMcpAuth;

  abstract get hooks(): HookRegistry;

  abstract get authProviders(): AuthRegistry;

  abstract get providers(): ProviderRegistryInterface;

  abstract get apps(): AppRegistry;

  abstract get tools(): ToolRegistry;

  abstract get resources(): ResourceRegistry;

  abstract get prompts(): PromptRegistry;

  abstract get skills(): SkillRegistryInterface;

  /** Enforces the active skills' tool allowlists per session; `undefined` when the scope has no skills and no `dynamicSkills` plugin. */
  abstract get skillSession(): SkillSessionManager | undefined;

  abstract get notifications(): NotificationService;

  /** Follows the entries' `enabled` sources, sends their coalesced `list_changed`, and finds stale tool lists. */
  abstract get surface(): LiveSurface | undefined;

  abstract get agents(): AgentRegistry;

  /** The server-level plugins (`@FrontMcp({ plugins })`, and the one `observability` loads); `undefined` when there are none. */
  abstract get plugins(): PluginRegistryInterface | undefined;

  /** The scope's jobs; `undefined` unless jobs are on (`jobs.enabled`, or a job or workflow declared on an app). */
  abstract get jobs(): JobRegistry | undefined;

  /** The scope's workflows; `undefined` when `jobs` is. */
  abstract get workflows(): WorkflowRegistry | undefined;

  abstract get toolUI(): ToolUIRegistry | undefined;

  /**
   * Registry of custom `@AuthUi` slot renderers + `@AuthExtra` validators (#469).
   * `undefined` in CLI mode or when no custom auth UI is configured — the OAuth
   * flows then serve the built-in HTML pages unchanged.
   */
  abstract get authUi(): AuthUiRegistry | undefined;

  abstract get transportService(): TransportService | undefined;

  /** The SSE resumability store every session shares; `undefined` unless `transport.eventStore` (or distributed Redis) enables it. */
  abstract get eventStore(): EventStore | undefined;

  haManager?: HaManager;

  /** The scope's `@HttpRoute`s, which the `http:route` flow serves; `undefined` when it has none. */
  declare httpRouteTable?: HttpRouteTable;

  abstract get rateLimitManager(): GuardManager | undefined;

  /** The guard `publicAccess.rateLimit` counts on: the throttle's, else its own when `throttle.enabled` is `false`. */
  abstract get publicAccessGuard(): GuardManager | undefined;

  abstract get elicitationStore(): ElicitationStore | undefined;

  /** The questions `elicitation.persistent` keeps; `undefined` while it is off. */
  abstract get persistentQuestions(): PersistentQuestions | undefined;

  /** Persistent store for MCP 2025-11-25 background task records. */
  abstract get taskStore(): TaskStore | undefined;

  /** Per-process task registry (AbortControllers + capability projection). */
  abstract get tasks(): TaskRegistry | undefined;

  /** The channels the scope serves; `undefined` unless `channels.enabled`. */
  abstract get channels(): ChannelRegistry | undefined;

  /** Sends channel notifications to the sessions subscribed to a channel; `undefined` unless `channels.enabled`. */
  abstract get channelNotifications(): ChannelNotificationService | undefined;

  /**
   * The bus `app-event` channel sources listen on: `this.scope.channelEventBus?.emit('app:error', payload)`.
   * `undefined` unless `channels.enabled`.
   */
  abstract get channelEventBus(): ChannelEventBus | undefined;

  abstract get authoritiesEngine(): AuthoritiesEngine | undefined;

  abstract get authoritiesContextBuilder(): AuthoritiesContextBuilder | undefined;

  abstract get authoritiesScopeMapping(): AuthoritiesScopeMapping | undefined;

  /**
   * Collect the OAuth scopes entries declare on their `authProviders`.
   * The PRM endpoint advertises them in `scopes_supported`.
   */
  abstract getAllSupportedScopes(): string[];

  /**
   * Run, for an app loaded after startup (a lazy app on its first call), the checks startup runs on every app:
   * metadata only a plugin enforces, the hooks' order, and the guard its tools' limits need. Throws what startup would.
   */
  abstract checkLateApp(app: LateAppRegistries): Promise<void>;

  /**
   * Lifecycle callbacks registered by plugins via onServerStarted().
   * Called after the HTTP server starts listening.
   */
  private readonly lifecycleCallbacks: Array<() => void | Promise<void>> = [];

  /**
   * Register a callback to run after the server has started.
   * Plugins can use this for post-startup initialization (e.g., warming caches,
   * starting background jobs, logging readiness).
   */
  onServerStarted(callback: () => void | Promise<void>): void {
    this.lifecycleCallbacks.push(callback);
  }

  /**
   * Emit the server-started lifecycle event. Called by FrontMcpInstance after server.start().
   * @internal
   */
  async emitServerStarted(): Promise<void> {
    for (const cb of this.lifecycleCallbacks) {
      await cb();
    }
  }

  /**
   * Run `change`, such as a plugin swapping the entries it registered, and send connected clients one `list_changed`
   * for each list it changed (tools, resources, prompts, skills) once it ends, also when it throws, instead of one per
   * registry change. A change that undoes itself, such as a rollback, calls `batch.listsRestored()` so nothing is sent.
   * A batch run inside another hands what it changed to the outer one. Changes made outside it, such as another
   * request's, are sent as they happen.
   */
  batchListChanges<T>(change: (batch: ListChangeBatch) => T | Promise<T>): Promise<T> {
    return runListChangeBatch(this, change);
  }

  private readonly addedHealthProbes: HealthProbeDefinition[] = [];

  /**
   * Add a check to the server's `/readyz` readiness probe, run with the built-in ones and the
   * `health.probes` the server configures. A check added at any time, while the server starts or after it,
   * runs from the next `/readyz` on; a check already running finishes with the checks it started with.
   * Two checks with one name both run, and `/readyz` shows the later one's result.
   *
   * @returns A function that removes the check.
   */
  registerHealthProbe(probe: HealthProbeDefinition): () => void {
    const registration: HealthProbeDefinition = { name: probe.name, check: () => probe.check() };
    this.addedHealthProbes.push(registration);
    return () => {
      const index = this.addedHealthProbes.indexOf(registration);
      if (index !== -1) this.addedHealthProbes.splice(index, 1);
    };
  }

  /**
   * The checks added with registerHealthProbe() and not removed. The health service reads it at every check.
   * @internal
   */
  get healthProbes(): readonly HealthProbeDefinition[] {
    return this.addedHealthProbes;
  }

  /** Teardown callbacks registered via onDispose(), run once when the scope is disposed. */
  private readonly disposeCallbacks: Array<() => void | Promise<void>> = [];
  private disposeEmitted = false;

  /**
   * Whether disposal has begun. Code that adds to the scope after an `await` checks it, so nothing is
   * added to a scope disposed in the meantime.
   * @internal
   */
  get isDisposed(): boolean {
    return this.disposeEmitted;
  }

  /**
   * Register a callback to run when the scope is disposed: `Scope.dispose()`, or `dispose()` on the
   * `DirectMcpServer` that `create()` returned. Plugins use it to release what they hold outside the
   * scope (timers, subscriptions, browser registrations). Unlike onServerStarted(), it also fires in
   * direct mode, where no HTTP server starts. Callbacks run in reverse order of registration; one
   * registered after the scope was disposed runs right away.
   *
   * @returns A function that removes the callback.
   */
  onDispose(callback: () => void | Promise<void>): () => void {
    if (this.disposeEmitted) {
      void this.runDisposeCallback(callback);
      return () => undefined;
    }
    this.disposeCallbacks.push(callback);
    return () => {
      const index = this.disposeCallbacks.indexOf(callback);
      if (index !== -1) this.disposeCallbacks.splice(index, 1);
    };
  }

  /**
   * Run the dispose callbacks, once. A callback that throws is logged and does not stop the others.
   * @internal
   */
  async emitDispose(): Promise<void> {
    if (this.disposeEmitted) return;
    this.disposeEmitted = true;
    const callbacks = this.disposeCallbacks.splice(0).reverse();
    for (const cb of callbacks) {
      await this.runDisposeCallback(cb);
    }
  }

  private async runDisposeCallback(callback: () => void | Promise<void>): Promise<void> {
    try {
      await callback();
    } catch (error) {
      this.logger.warn(`Scope dispose callback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  abstract registryFlows(...flows: FlowType[]): Promise<void>;

  abstract runFlow<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    additionalDeps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined>;

  abstract runFlowForOutput<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    additionalDeps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name>>;
}
