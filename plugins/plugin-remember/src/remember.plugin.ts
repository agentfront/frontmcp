import {
  DynamicPlugin,
  Plugin,
  ProviderType,
  ProviderScope,
  FrontMcpConfig,
  FrontMcpConfigType,
  FrontMcpContext,
  FRONTMCP_CONTEXT,
  getGlobalStoreConfig,
  isVercelKvProvider,
} from '@frontmcp/sdk';
import type { RememberPluginOptions, RememberPluginOptionsInput } from './remember.types';
import {
  RememberStoreToken,
  RememberConfigToken,
  RememberAccessorToken,
  ApprovalStoreToken,
  ApprovalServiceToken,
} from './remember.symbols';
import RememberMemoryProvider from './providers/remember-memory.provider';
import RememberRedisProvider from './providers/remember-redis.provider';
import RememberVercelKvProvider from './providers/remember-vercel-kv.provider';
import { createRememberAccessor } from './providers/remember-accessor.provider';
import { ApprovalMemoryStore } from './approval/approval-memory.store';
import { createApprovalService } from './approval/approval.service';
import ApprovalCheckPlugin from './approval/approval-check.hook';

/**
 * RememberPlugin - Stateful session memory for FrontMCP.
 *
 * Provides encrypted, session-scoped storage with human-friendly API.
 * Enables LLMs and tools to "remember" things across sessions.
 *
 * @example
 * ```typescript
 * // Basic in-memory setup
 * @FrontMcp({
 *   plugins: [
 *     RememberPlugin.init({ type: 'memory' }),
 *   ],
 * })
 * class MyServer {}
 *
 * // With Redis and LLM tools
 * @FrontMcp({
 *   redis: { host: 'localhost', port: 6379 },
 *   plugins: [
 *     RememberPlugin.init({
 *       type: 'global-store',
 *       tools: { enabled: true },
 *       approval: { enabled: true },
 *     }),
 *   ],
 * })
 * class ProductionServer {}
 * ```
 */
@Plugin({
  name: 'remember',
  description: 'Help your LLM remember things across sessions',
  providers: [
    // Default in-memory provider (overridden by dynamicProviders if configured)
    {
      name: 'remember:store:memory',
      provide: RememberStoreToken,
      useValue: new RememberMemoryProvider(),
    },
  ],
  // Context extensions - SDK handles runtime installation
  // TypeScript types are declared in remember.context-extension.ts
  contextExtensions: [
    {
      property: 'remember',
      token: RememberAccessorToken,
      errorMessage: 'RememberPlugin is not installed. Add RememberPlugin.init() to your plugins array.',
    },
    {
      property: 'approval',
      token: ApprovalServiceToken,
      errorMessage: 'RememberPlugin approval is not enabled. Set approval: { enabled: true } in plugin options.',
    },
  ],
})
export default class RememberPlugin extends DynamicPlugin<RememberPluginOptions, RememberPluginOptionsInput> {
  static defaultOptions: RememberPluginOptions = {
    type: 'memory',
    keyPrefix: 'remember:',
    encryption: { enabled: true },
  };

  options: RememberPluginOptions;

  constructor(options: RememberPluginOptionsInput = {}) {
    super();
    this.options = {
      ...RememberPlugin.defaultOptions,
      ...options,
    } as RememberPluginOptions;
  }

  /**
   * Dynamic providers based on plugin options.
   */
  static override dynamicProviders = (options: RememberPluginOptionsInput): ProviderType[] => {
    const providers: ProviderType[] = [];
    const config: RememberPluginOptions = {
      ...RememberPlugin.defaultOptions,
      ...options,
    } as RememberPluginOptions;

    // ─────────────────────────────────────────────────────────────────────────
    // Storage Provider
    // ─────────────────────────────────────────────────────────────────────────

    switch (config.type) {
      case 'global-store':
        providers.push({
          name: 'remember:store:global',
          provide: RememberStoreToken,
          inject: () => [FrontMcpConfig] as const,
          useFactory: (frontmcpConfig: FrontMcpConfigType) => {
            const storeConfig = getGlobalStoreConfig('RememberPlugin', frontmcpConfig);

            if (isVercelKvProvider(storeConfig)) {
              return new RememberVercelKvProvider({
                url: storeConfig.url,
                token: storeConfig.token,
                keyPrefix: config.keyPrefix,
                defaultTTL: config.defaultTTL,
              });
            }

            // Redis provider
            return new RememberRedisProvider({
              type: 'redis',
              config: {
                host: storeConfig.host ?? 'localhost',
                port: storeConfig.port ?? 6379,
                password: storeConfig.password,
                db: storeConfig.db,
              },
              keyPrefix: config.keyPrefix,
              defaultTTL: config.defaultTTL,
            });
          },
        });
        break;

      case 'redis':
        if ('config' in config && config.config) {
          providers.push({
            name: 'remember:store:redis',
            provide: RememberStoreToken,
            useValue: new RememberRedisProvider({
              type: 'redis',
              config: config.config,
              keyPrefix: config.keyPrefix,
              defaultTTL: config.defaultTTL,
            }),
          });
        }
        break;

      case 'redis-client':
        if ('client' in config && config.client) {
          providers.push({
            name: 'remember:store:redis-client',
            provide: RememberStoreToken,
            useValue: new RememberRedisProvider({
              type: 'redis-client',
              client: config.client,
              keyPrefix: config.keyPrefix,
              defaultTTL: config.defaultTTL,
            }),
          });
        }
        break;

      case 'vercel-kv':
        providers.push({
          name: 'remember:store:vercel-kv',
          provide: RememberStoreToken,
          useValue: new RememberVercelKvProvider({
            url: 'url' in config ? config.url : undefined,
            token: 'token' in config ? config.token : undefined,
            keyPrefix: config.keyPrefix,
            defaultTTL: config.defaultTTL,
          }),
        });
        break;

      case 'memory':
      default:
        providers.push({
          name: 'remember:store:memory',
          provide: RememberStoreToken,
          useValue: new RememberMemoryProvider(),
        });
        break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Config Provider
    // ─────────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'remember:config',
      provide: RememberConfigToken,
      useValue: config,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // RememberAccessor (Context-scoped)
    // ─────────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'remember:accessor',
      provide: RememberAccessorToken,
      scope: ProviderScope.CONTEXT,
      inject: () => [RememberStoreToken, FRONTMCP_CONTEXT, RememberConfigToken] as const,
      useFactory: (store, ctx, cfg) => createRememberAccessor(store, ctx, cfg),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Approval System (if enabled)
    // ─────────────────────────────────────────────────────────────────────────

    if (config.approval?.enabled) {
      // Approval Store
      providers.push({
        name: 'remember:approval-store',
        provide: ApprovalStoreToken,
        useValue: new ApprovalMemoryStore(),
      });

      // Approval Service (Context-scoped)
      providers.push({
        name: 'remember:approval-service',
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
    }

    return providers;
  };

  /**
   * Get plugin metadata including nested plugins.
   */
  static getPluginMetadata(options: RememberPluginOptionsInput): { plugins?: unknown[] } {
    const plugins: unknown[] = [];

    // Include approval check hook if approval is enabled
    if (options.approval?.enabled) {
      plugins.push(ApprovalCheckPlugin);
    }

    return plugins.length > 0 ? { plugins } : {};
  }
}
