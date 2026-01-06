/**
 * ApprovalPlugin - Tool authorization workflow with PKCE webhook security.
 *
 * @module @frontmcp/plugin-approval
 */

import { DynamicPlugin, Plugin, ProviderType, ProviderScope, FrontMcpContext, FRONTMCP_CONTEXT } from '@frontmcp/sdk';
import type { StorageConfig, RootStorage, NamespacedStorage } from '@frontmcp/utils';

import { ApprovalStorageStore } from './stores/approval-storage.store';
import { createApprovalService } from './services/approval.service';
import { ChallengeService } from './services/challenge.service';
import { ApprovalStoreToken, ApprovalServiceToken, ChallengeServiceToken } from './approval.symbols';
import ApprovalCheckPlugin from './hooks/approval-check.hook';
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
   * Approval workflow mode.
   * - 'recheck': Poll external API for approval status
   * - 'webhook': Use PKCE-secured webhooks for approval
   * @default 'recheck'
   */
  mode?: ApprovalMode;

  /**
   * Recheck mode configuration.
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
   * Webhook mode configuration.
   */
  webhook?: {
    /** URL to send approval requests */
    url?: string;
    /** Include JWT in webhook payload */
    includeJwt?: boolean;
    /** Challenge TTL in seconds */
    challengeTtl?: number;
    /** Callback path for approval responses */
    callbackPath?: string;
  };

  /**
   * Enable approval audit logging.
   * @default true
   */
  enableAudit?: boolean;

  /**
   * Maximum delegation depth for delegated approvals.
   * @default 3
   */
  maxDelegationDepth?: number;

  /**
   * Cleanup interval for expired approvals (seconds).
   * @default 60
   */
  cleanupIntervalSeconds?: number;
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
 * - PKCE webhook security for external approval systems
 * - Recheck mode for polling approval status
 * - Full audit trail support
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
 *       webhook: {
 *         url: 'https://approval.example.com/webhook',
 *         challengeTtl: 300,
 *       },
 *     }),
 *   ],
 * })
 * class MyServer {}
 * ```
 */
@Plugin({
  name: 'approval',
  description: 'Tool authorization workflow with PKCE webhook security',
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
    enableAudit: true,
    maxDelegationDepth: 3,
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

    providers.push({
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
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Challenge Service (for webhook mode)
    // ─────────────────────────────────────────────────────────────────────────

    if (config.mode === 'webhook') {
      providers.push({
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
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Approval Service (Context-scoped)
    // ─────────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'approval:service',
      provide: ApprovalServiceToken,
      scope: ProviderScope.CONTEXT,
      inject: () => [ApprovalStoreToken, FRONTMCP_CONTEXT] as const,
      useFactory: (store, ctx: FrontMcpContext) => {
        const userId =
          (ctx.authInfo?.extra?.['userId'] as string | undefined) ??
          (ctx.authInfo?.extra?.['sub'] as string | undefined) ??
          ctx.authInfo?.clientId;
        return createApprovalService(store, ctx.sessionId, userId);
      },
    });

    return providers;
  };

  /**
   * Get plugin metadata including nested plugins.
   */
  static getPluginMetadata(_options: ApprovalPluginOptions): { plugins?: unknown[] } {
    // Always include approval check hook
    return { plugins: [ApprovalCheckPlugin] };
  }
}

// Also export as named export
export { ApprovalPlugin };
