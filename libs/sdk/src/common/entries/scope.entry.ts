import type { AuthoritiesContextBuilder, AuthoritiesEngine, AuthoritiesScopeMapping } from '@frontmcp/auth';
import type { Token, Type } from '@frontmcp/di';
import type { GuardManager } from '@frontmcp/guard';

import type AgentRegistry from '../../agent/agent.registry';
import type AppRegistry from '../../app/app.registry';
import type { AuthUiRegistry } from '../../auth/auth-ui';
import type { AuthRegistry } from '../../auth/auth.registry';
import type { ElicitationStore } from '../../elicitation/store/elicitation.store';
import type { HaManager } from '../../ha';
import type HookRegistry from '../../hooks/hook.registry';
import type { NotificationService } from '../../notification';
import type PromptRegistry from '../../prompt/prompt.registry';
import type ResourceRegistry from '../../resource/resource.registry';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import type { TaskStore } from '../../task/store/task.store';
import type { TaskRegistry } from '../../task/task.registry';
import type ToolRegistry from '../../tool/tool.registry';
import type { ToolUIRegistry } from '../../tool/ui/ui-shared';
import type { TransportService } from '../../transport/transport.registry';
import type {
  FlowInputOf,
  FlowOutputOf,
  FlowType,
  FrontMcpAuth,
  FrontMcpLogger,
  ProviderRegistryInterface,
} from '../interfaces';
import type { FlowName, ScopeMetadata } from '../metadata';
import type { ScopeRecord } from '../records';
import { normalizeEntryPrefix, normalizeScopeBase } from '../utils';
import { BaseEntry } from './base.entry';

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

  abstract get notifications(): NotificationService;

  abstract get agents(): AgentRegistry;

  abstract get toolUI(): ToolUIRegistry | undefined;

  /**
   * Registry of custom `@AuthUi` slot renderers + `@AuthExtra` validators (#469).
   * `undefined` in CLI mode or when no custom auth UI is configured — the OAuth
   * flows then serve the built-in HTML pages unchanged.
   */
  abstract get authUi(): AuthUiRegistry | undefined;

  abstract get transportService(): TransportService | undefined;

  haManager?: HaManager;

  abstract get rateLimitManager(): GuardManager | undefined;

  abstract get elicitationStore(): ElicitationStore | undefined;

  /** Persistent store for MCP 2025-11-25 background task records. */
  abstract get taskStore(): TaskStore | undefined;

  /** Per-process task registry (AbortControllers + capability projection). */
  abstract get tasks(): TaskRegistry | undefined;

  abstract get authoritiesEngine(): AuthoritiesEngine | undefined;

  abstract get authoritiesContextBuilder(): AuthoritiesContextBuilder | undefined;

  abstract get authoritiesScopeMapping(): AuthoritiesScopeMapping | undefined;

  /**
   * Collect the OAuth scopes entries declare on their `authProviders`.
   * The PRM endpoint advertises them in `scopes_supported`.
   */
  abstract getAllSupportedScopes(): string[];

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
