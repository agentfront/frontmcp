/**
 * ApprovalPlugin - Tool authorization workflow with PKCE webhook security.
 *
 * @module @frontmcp/plugin-approval
 */

import {
  DynamicPlugin,
  FRONTMCP_CONTEXT,
  Plugin,
  ProviderRegistry,
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
import { resolveExternalApproval, type ResolvedExternalApproval, type ResolvedRecheck } from './approval.options';
import {
  ApprovalServiceToken,
  ApprovalStoreToken,
  ChallengeServiceToken,
  ExternalApproverToken,
} from './approval.symbols';
import { resolveApprovalRequirement } from './approval/policy';
import { serveApprovalCallback } from './external/approval-callback.flow';
import { ApprovalDecisionRecorder } from './external/approval-decisions';
import { RecheckApprover, type RecheckRequest } from './external/recheck-approver';
import { WebhookApprover } from './external/webhook-approver';
import ApprovalCheckPlugin from './hooks/approval-check.hook';
import { createApprovalService, type ApprovalRequirementLookup } from './services/approval.service';
import { ChallengeService } from './services/challenge.service';
import { ApprovalStorageStore } from './stores/approval-storage.store';
import type { ApprovalMode } from './types';

/** The approval policy of the scope's tool with this full name, or `undefined` when there is no such tool. */
function toolRequirementLookup(scope: ScopeEntry): ApprovalRequirementLookup {
  return (toolId) => {
    const tool = scope.tools.getTools(true).find((entry) => entry.fullName === toolId);
    if (!tool) return undefined;
    const approval = (tool.metadata as { approval?: ToolApprovalRequirement | boolean }).approval;
    return resolveApprovalRequirement(approval);
  };
}

/**
 * The provider of the external approver `external` configures, which also serves the webhook's callback route. The
 * store and the challenge service are built beside it, at the same time, so it reads them on first use.
 */
function externalApproverProvider(external: ResolvedExternalApproval): ProviderType | undefined {
  const { webhook, recheck } = external;
  if (!webhook && !recheck) return undefined;
  return {
    name: 'approval:external-approver',
    provide: ExternalApproverToken,
    inject: () => [ProviderRegistry, ScopeEntry] as const,
    useFactory: async (providers: ProviderRegistry, scope: ScopeEntry) => {
      const logger = scope.logger.child('ApprovalPlugin');
      const requirementOf = toolRequirementLookup(scope);
      const dependencies = {
        get challenges(): ChallengeService {
          return providers.get(ChallengeServiceToken);
        },
        get decisions(): ApprovalDecisionRecorder {
          return new ApprovalDecisionRecorder(providers.get(ApprovalStoreToken), requirementOf, logger);
        },
      };
      if (!webhook) return new RecheckApprover(recheck as ResolvedRecheck, dependencies, logger);
      const approver = new WebhookApprover(webhook, dependencies, logger);
      await serveApprovalCallback(scope, webhook.callbackPath, approver);
      return approver;
    },
  };
}

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
   * Approval workflow mode. Approvals are recorded by your code (`this.approval`, the store) in both; an external
   * approval system is asked only when its URL is set.
   * - 'recheck': Check the stored approvals on every call. With `recheck.url`, a call without one polls that URL until
   *   it decides.
   * - 'webhook': Also register the PKCE `ChallengeService` (`ChallengeServiceToken`). With `webhook.url`, a call
   *   without an approval sends a signed request there, and the decision comes back on `webhook.callbackPath`.
   * @default 'recheck'
   */
  mode?: ApprovalMode;

  /**
   * Recheck mode: poll an approval system's URL for a decision about a call that has no approval. Each poll is a signed
   * (with `secret`) JSON POST of `{ type: 'approval.status', requestId, attempt, toolId, toolName, userId?, ... }`,
   * answered with `{ approved, pending?, scope?, ttlMs?, grantedBy?, denialReason? }`: an approval is recorded, as the
   * tool's policy allows, and the call runs; `{ approved: false }` refuses it as denied; `pending: true` polls again.
   * A failed poll, or `maxAttempts` pending answers, refuses the call as pending. Needs `mode: 'recheck'`.
   */
  recheck?: {
    /** The approval system's status URL: `https://`, or `http://localhost` when NODE_ENV is not production. */
    url?: string;
    /**
     * How each poll authenticates:
     * - `'none'`: no `Authorization` header (sign the polls with `secret`).
     * - `'bearer'`: `Authorization: Bearer <token>`.
     * - `'jwt'`: forwards the caller's own access token as `Authorization: Bearer`; a call without one isn't polled.
     * - `'custom'`: the headers `headers(request)` returns.
     * @default 'none'
     */
    auth?: 'jwt' | 'bearer' | 'none' | 'custom';
    /** The token `auth: 'bearer'` sends. */
    token?: string;
    /** The headers `auth: 'custom'` sends, for the poll's body. */
    headers?: RecheckHeaders;
    /** Signs each poll (HMAC-SHA256, Standard Webhooks headers); at least 24 bytes. A `whsec_` secret is base64. */
    secret?: string;
    /** Interval between polls (ms), 100 to 60000. @default 2000 */
    interval?: number;
    /** Most polls per call, 1 to 60; `interval × (maxAttempts − 1)` must be 2 minutes or less. @default 5 */
    maxAttempts?: number;
  };

  /**
   * Webhook mode: ask an approval system by webhook. With `url`, a call that needs an approval it doesn't have sends
   * one signed JSON POST (`WebhookPayload`) there per caller and tool, and is refused as pending; the system decides by
   * POSTing `{ codeVerifier, approved, scope?, ttlMs?, grantedBy?, reason? }`, signed with the same secret, to
   * `callbackPath`. Needs `mode: 'webhook'`.
   */
  webhook?: {
    /** Where approval requests are sent: `https://`, or `http://localhost` when NODE_ENV is not production. */
    url?: string;
    /**
     * Signs each request and verifies each callback (HMAC-SHA256 in the Standard Webhooks format); required with
     * `url`, at least 24 bytes. A `whsec_` secret (a Standard Webhooks secret) is base64 after the prefix.
     */
    secret?: string;
    /**
     * Forward the caller's access token to `url`, as the request's `jwt` field. Only set it when the approval system
     * must act as the caller: the token reaches that system as is.
     * @default false
     */
    includeJwt?: boolean;
    /** Challenge TTL in seconds: how long a request waits for its decision, and a denial without `ttlMs` lasts */
    challengeTtl?: number;
    /** The path the server takes decisions on (`POST`). @default '/approval/callback' */
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

/** The headers `recheck.auth: 'custom'` sends with a poll. */
export type RecheckHeaders = (request: RecheckRequest) => Record<string, string> | Promise<Record<string, string>>;

/** The options in `options` that are accepted and have no effect, by their path. */
function ignoredApprovalOptions(options: ApprovalPluginOptions): string[] {
  const ignored = [
    options.enableAudit !== undefined && 'enableAudit',
    options.maxDelegationDepth !== undefined && 'maxDelegationDepth',
  ];
  return ignored.filter((path): path is string => path !== false);
}

function describeIgnoredOptions(ignored: readonly string[]): string {
  return (
    `ApprovalPlugin ignores \`${ignored.join('`, `')}\`: the plugin logs no audit trail and bounds no delegation. ` +
    'Each approval record keeps who granted or revoked it. Remove these options.'
  );
}

/** The options set that the plugin ignores, logged when the server starts. */
const ApprovalOptionWarningsToken: Token<string[]> = Symbol('plugin:approval:option-warnings');

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalPlugin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ApprovalPlugin for tool authorization workflows.
 *
 * Features:
 * - Tool approval checking via hook
 * - Multiple approval scopes (session, user, time-limited, context-specific)
 * - Signed approval requests to an external system, decided on a PKCE-bound callback (`mode: 'webhook'`)
 * - Polling an external approval API (`mode: 'recheck'` with `recheck.url`)
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
 *       webhook: {
 *         url: 'https://approval.example.com/webhook',
 *         secret: process.env.APPROVAL_WEBHOOK_SECRET,
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
    const external = resolveExternalApproval(config);

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

    const externalApprover = externalApproverProvider(external);
    if (externalApprover) providers.push(externalApprover);

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
        return createApprovalService(store, sessionId, userId, toolRequirementLookup(scope));
      },
    });

    return providers;
  };
}

// Also export as named export
export { ApprovalPlugin };
