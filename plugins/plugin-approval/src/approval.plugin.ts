/**
 * ApprovalPlugin - Tool authorization workflow with PKCE webhook security.
 *
 * @module @frontmcp/plugin-approval
 */

import {
  DynamicPlugin,
  FRONTMCP_CONTEXT,
  Plugin,
  ProviderScope,
  ScopeEntry,
  storeProvider,
  type FrontMcpContext,
  type PluginStoreInBrowser,
  type ProviderType,
  type Token,
} from '@frontmcp/sdk';
import type { NamespacedStorage, RootStorage, StorageConfig } from '@frontmcp/utils';

import type { ToolApprovalRequirement } from './approval';
import { resolveApprovalIdentity } from './approval.identity';
import { ApprovalServiceToken, ApprovalStoreToken, ChallengeServiceToken } from './approval.symbols';
import { resolveApprovalRequirement } from './approval/policy';
import ApprovalCheckPlugin from './hooks/approval-check.hook';
import { createApprovalService } from './services/approval.service';
import { ChallengeService } from './services/challenge.service';
import { ApprovalStorageStore } from './stores/approval-storage.store';
import type { ApprovalMode } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration options for ApprovalPlugin.
 */
export interface ApprovalPluginOptions {
  /**
   * Storage configuration for approvals.
   * @default { type: 'auto' }
   */
  storage?: StorageConfig;

  /**
   * Use existing storage instance.
   */
  storageInstance?: RootStorage | NamespacedStorage;

  /**
   * Namespace for approval keys.
   * @default 'approval'
   */
  namespace?: string;

  /**
   * Approval workflow mode. Neither contacts an external system: approvals are recorded by your code.
   * - 'recheck': Check the stored approvals on every call
   * - 'webhook': Also register the PKCE `ChallengeService` (`ChallengeServiceToken`)
   * @default 'recheck'
   */
  mode?: ApprovalMode;

  /**
   * @deprecated Has no effect: nothing is polled. A server that sets it logs a warning when it starts.
   */
  recheck?: {
    /** URL to check for approval status */
    url?: string;
    /** Authentication method */
    auth?: 'jwt' | 'bearer' | 'none' | 'custom';
    /** Interval between rechecks (ms) */
    interval?: number;
    /** Maximum recheck attempts */
    maxAttempts?: number;
  };

  /**
   * Webhook mode configuration. Only `challengeTtl` is used; no request is sent and no callback route is served.
   */
  webhook?: {
    /** @deprecated Has no effect: no request is sent. A server that sets it logs a warning when it starts. */
    url?: string;
    /** @deprecated Has no effect: no request is sent. A server that sets it logs a warning when it starts. */
    includeJwt?: boolean;
    /** Challenge TTL in seconds */
    challengeTtl?: number;
    /** @deprecated Has no effect: no callback route is served. A server that sets it logs a warning when it starts. */
    callbackPath?: string;
  };

  /**
   * @deprecated Has no effect: an approval record already keeps who granted or revoked it, and nothing else is
   * logged. A server that sets it logs a warning when it starts.
   */
  enableAudit?: boolean;

  /**
   * @deprecated Has no effect: a delegated grant names one delegator, so there is no chain to bound. A server that
   * sets it logs a warning when it starts.
   */
  maxDelegationDepth?: number;

  /**
   * Cleanup interval for expired approvals (seconds).
   * @default 60
   */
  cleanupIntervalSeconds?: number;
}

/** The options set that the plugin ignores, logged when the server starts. */
const ApprovalOptionWarningsToken: Token<string[]> = Symbol('plugin:approval:option-warnings');

/** The options in `options` that are accepted and have no effect, by their path. */
function ignoredApprovalOptions(options: ApprovalPluginOptions): string[] {
  const ignored = [
    options.webhook?.url !== undefined && 'webhook.url',
    options.webhook?.includeJwt !== undefined && 'webhook.includeJwt',
    options.webhook?.callbackPath !== undefined && 'webhook.callbackPath',
    options.recheck !== undefined && 'recheck',
    options.enableAudit !== undefined && 'enableAudit',
    options.maxDelegationDepth !== undefined && 'maxDelegationDepth',
  ];
  return ignored.filter((path): path is string => path !== false);
}

function describeIgnoredOptions(ignored: readonly string[]): string {
  return (
    `ApprovalPlugin ignores \`${ignored.join('`, `')}\`: the plugin sends no webhook, serves no callback route, polls ` +
    'nothing and logs no audit trail. Approvals are recorded by your code, such as this.approval.grantSessionApproval(), ' +
    'and each record keeps who granted or revoked it. Remove these options.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalPlugin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ApprovalPlugin for tool authorization workflows.
 *
 * Features:
 * - Tool approval checking via hook
 * - Multiple approval scopes (session, user, time-limited, context-specific)
 * - PKCE challenges (`mode: 'webhook'`) to build an external approval flow on
 * - Who granted or revoked each approval, kept with it
 *
 * @example Basic usage
 * ```typescript
 * import { ApprovalPlugin } from '@frontmcp/plugin-approval';
 *
 * @FrontMcp({
 *   plugins: [ApprovalPlugin.init()],
 * })
 * class MyServer {}
 * ```
 *
 * @example With webhook mode
 * ```typescript
 * @FrontMcp({
 *   plugins: [
 *     ApprovalPlugin.init({
 *       mode: 'webhook',
 *       webhook: { challengeTtl: 300 },
 *     }),
 *   ],
 * })
 * class MyServer {}
 * ```
 */
@Plugin({
  name: 'approval',
  description: 'Tool authorization workflow with PKCE webhook security',
  plugins: [ApprovalCheckPlugin],
  contextExtensions: [
    {
      property: 'approval',
      token: ApprovalServiceToken,
      errorMessage: 'ApprovalPlugin is not installed. Add ApprovalPlugin.init() to your plugins array.',
    },
  ],
})
export default class ApprovalPlugin extends DynamicPlugin<ApprovalPluginOptions> {
  static defaultOptions: ApprovalPluginOptions = {
    namespace: 'approval',
    mode: 'recheck',
    cleanupIntervalSeconds: 60,
  };

  options: ApprovalPluginOptions;

  constructor(options: ApprovalPluginOptions = {}) {
    super();
    this.options = {
      ...ApprovalPlugin.defaultOptions,
      ...options,
    };
  }

  /** A `storage` on Redis or SQLite, which a browser refuses at startup (#1033); a `storageInstance` replaces it. */
  static override browserStores = ({ storage, storageInstance }: ApprovalPluginOptions): PluginStoreInBrowser[] => {
    const type = storageInstance ? undefined : storage?.type;
    return [
      {
        plugin: 'ApprovalPlugin',
        option: type === 'redis' || type === 'sqlite' ? `storage: { type: '${type}' }` : undefined,
        memory: "storage: { type: 'memory' }",
      },
    ];
  };

  /**
   * Dynamic providers based on plugin options.
   */
  static override dynamicProviders = (options: ApprovalPluginOptions): ProviderType[] => {
    const providers: ProviderType[] = [];
    const config: ApprovalPluginOptions = {
      ...ApprovalPlugin.defaultOptions,
      ...options,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Approval Store
    // ─────────────────────────────────────────────────────────────────────────

    providers.push(
      storeProvider({
        name: 'approval:store',
        provide: ApprovalStoreToken,
        inject: () => [] as const,
        useFactory: async () => {
          const store = new ApprovalStorageStore({
            storage: config.storage,
            storageInstance: config.storageInstance,
            namespace: config.namespace,
            cleanupIntervalSeconds: config.cleanupIntervalSeconds,
          });
          await store.initialize();
          return store;
        },
      }),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Challenge Service (for webhook mode)
    // ─────────────────────────────────────────────────────────────────────────

    if (config.mode === 'webhook') {
      providers.push(
        storeProvider({
          name: 'approval:challenge-service',
          provide: ChallengeServiceToken,
          inject: () => [] as const,
          useFactory: async () => {
            const service = new ChallengeService({
              storage: config.storage,
              storageInstance: config.storageInstance,
              namespace: `${config.namespace}:challenge`,
              defaultTtlSeconds: config.webhook?.challengeTtl ?? 300,
            });
            await service.initialize();
            return service;
          },
        }),
      );
    }

    providers.push({
      name: 'approval:option-warnings',
      provide: ApprovalOptionWarningsToken,
      inject: () => [ScopeEntry] as const,
      useFactory: (scope: ScopeEntry) => {
        const ignored = ignoredApprovalOptions(options);
        if (ignored.length > 0) scope.logger.child('ApprovalPlugin').warn(describeIgnoredOptions(ignored));
        return ignored;
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Approval Service (Context-scoped)
    // ─────────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'approval:service',
      provide: ApprovalServiceToken,
      scope: ProviderScope.CONTEXT,
      inject: () => [ApprovalStoreToken, FRONTMCP_CONTEXT, ScopeEntry] as const,
      useFactory: (store, ctx: FrontMcpContext, scope: ScopeEntry) => {
        const { sessionId, userId } = resolveApprovalIdentity(ctx);
        // Grants are checked against the tool's `allowedScopes` and `maxTtlMs`.
        const requirementOf = (toolId: string) => {
          const tool = scope.tools.getTools(true).find((entry) => entry.fullName === toolId);
          if (!tool) return undefined;
          const approval = (tool.metadata as { approval?: ToolApprovalRequirement | boolean }).approval;
          return resolveApprovalRequirement(approval);
        };
        return createApprovalService(store, sessionId, userId, requirementOf);
      },
    });

    return providers;
  };
}

// Also export as named export
export { ApprovalPlugin };
