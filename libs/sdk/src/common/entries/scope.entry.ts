import { Token, Type } from '@frontmcp/di';
import { BaseEntry } from './base.entry';
import { ScopeRecord } from '../records';
import {
  ProviderRegistryInterface,
  FrontMcpAuth,
  FlowInputOf,
  FlowOutputOf,
  FlowType,
  FrontMcpLogger,
} from '../interfaces';
import { FlowName, ScopeMetadata } from '../metadata';
import { normalizeEntryPrefix, normalizeScopeBase } from '../utils';
import type { NotificationService } from '../../notification';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import type { ToolUIRegistry } from '../../tool/ui/ui-shared';
import type { TransportService } from '../../transport/transport.registry';
import type { ElicitationStore } from '../../elicitation/store/elicitation.store';
import type { GuardManager } from '@frontmcp/guard';
import type { AuthoritiesEngine, AuthoritiesContextBuilder, AuthoritiesScopeMapping } from '@frontmcp/auth';
import type HookRegistry from '../../hooks/hook.registry';
import type { AuthRegistry } from '../../auth/auth.registry';
import type AppRegistry from '../../app/app.registry';
import type ToolRegistry from '../../tool/tool.registry';
import type ResourceRegistry from '../../resource/resource.registry';
import type PromptRegistry from '../../prompt/prompt.registry';
import type AgentRegistry from '../../agent/agent.registry';

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

  abstract get transportService(): TransportService | undefined;

  abstract get rateLimitManager(): GuardManager | undefined;

  abstract get elicitationStore(): ElicitationStore | undefined;

  abstract get authoritiesEngine(): AuthoritiesEngine | undefined;

  abstract get authoritiesContextBuilder(): AuthoritiesContextBuilder | undefined;

  abstract get authoritiesScopeMapping(): AuthoritiesScopeMapping | undefined;

  /**
   * Collect all supported OAuth scopes from base OIDC scopes and
   * tool-level authProvider scope declarations.
   * Used by PRM endpoint to populate `scopes_supported`.
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
