import {
  DynamicPlugin,
  FlowCtxOf,
  Plugin,
  ProviderType,
  ToolHook,
  FrontMcpConfig,
  FrontMcpConfigType,
  getGlobalStoreConfig,
  isVercelKvProvider,
  FrontMcpContextStorage,
} from '@frontmcp/sdk';
import CacheRedisProvider from './providers/cache-redis.provider';
import CacheMemoryProvider from './providers/cache-memory.provider';
import CacheVercelKvProvider from './providers/cache-vercel-kv.provider';
import { CachePluginOptions, GlobalStoreCachePluginOptions } from './cache.types';
import { CacheStoreToken } from './cache.symbol';

/**
 * Default bypass header for cache.
 * Uses x-frontmcp-* prefix to match the header extraction pattern in FrontMcpContextStorage.
 */
const DEFAULT_BYPASS_HEADER = 'x-frontmcp-disable-cache';

/**
 * Check if a tool name matches any of the provided patterns.
 * Supports exact names and glob patterns with wildcards (*).
 */
function matchesToolPattern(toolName: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;

  return patterns.some((pattern) => {
    if (pattern.includes('*')) {
      // Escape special regex characters except *
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      // Convert * to regex .*
      const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
      return regex.test(toolName);
    }
    return pattern === toolName;
  });
}

@Plugin({
  name: 'cache',
  description: 'Cache plugin for caching tool results',
  providers: [
    /* add providers that always loaded with the plugin or default providers */
    {
      // this is a default provider for cache, will be overridden if dynamicProviders based on config
      name: 'cache:memory',
      provide: CacheStoreToken,
      useValue: new CacheMemoryProvider(60 * 60 * 24),
    },
  ],
})
export default class CachePlugin extends DynamicPlugin<CachePluginOptions> {
  static override dynamicProviders = (options: CachePluginOptions) => {
    const providers: ProviderType[] = [];
    switch (options.type) {
      case 'global-store':
        // Use inject/useFactory to access FrontMcpConfig at runtime
        providers.push({
          name: 'cache:global-store',
          provide: CacheStoreToken,
          inject: () => [FrontMcpConfig] as const,
          useFactory: (config: FrontMcpConfigType) => {
            const storeConfig = getGlobalStoreConfig('CachePlugin', config);
            const globalOptions = options as GlobalStoreCachePluginOptions;

            if (isVercelKvProvider(storeConfig)) {
              return new CacheVercelKvProvider({
                url: storeConfig.url,
                token: storeConfig.token,
                keyPrefix: storeConfig.keyPrefix,
                defaultTTL: globalOptions.defaultTTL,
              });
            }

            // Redis provider (including legacy format without provider field)
            return new CacheRedisProvider({
              type: 'redis',
              config: {
                host: storeConfig.host ?? 'localhost',
                port: storeConfig.port ?? 6379,
                password: storeConfig.password,
                db: storeConfig.db,
              },
              defaultTTL: globalOptions.defaultTTL,
            });
          },
        });
        break;
      case 'redis':
      case 'redis-client':
        providers.push({
          name: 'cache:redis',
          provide: CacheStoreToken,
          useValue: new CacheRedisProvider(options),
        });
        break;
      case 'memory':
        providers.push({
          name: 'cache:memory',
          provide: CacheStoreToken,
          useValue: new CacheMemoryProvider(options.defaultTTL),
        });
        break;
    }
    return providers;
  };

  static defaultOptions: CachePluginOptions = {
    type: 'memory',
  };
  options: CachePluginOptions;

  constructor(options: CachePluginOptions = CachePlugin.defaultOptions) {
    super();
    this.options = {
      defaultTTL: 60 * 60 * 24,
      ...options,
    };
  }

  /**
   * Check if a tool should be cached based on metadata or tools list.
   */
  private shouldCacheTool(
    toolName: string,
    cacheMetadata?: boolean | { ttl?: number; slideWindow?: boolean },
  ): boolean {
    // If metadata explicitly enables cache, use it
    if (cacheMetadata) return true;

    // Check if tool matches the configured patterns
    const patterns = this.options.toolPatterns ?? [];
    return matchesToolPattern(toolName, patterns);
  }

  /**
   * Check if cache should be bypassed based on request headers.
   * Accesses headers from FrontMcpContextStorage which extracts x-frontmcp-* custom headers.
   */
  private shouldBypassCache(_flowCtx: FlowCtxOf<'tools:call-tool'>): boolean {
    const bypassHeader = this.options.bypassHeader ?? DEFAULT_BYPASS_HEADER;

    try {
      // Get custom headers from the context storage
      // Headers with x-frontmcp-* prefix are stored in metadata.customHeaders
      const contextStorage = this.get(FrontMcpContextStorage);
      const context = contextStorage?.getStore();
      const customHeaders = context?.metadata?.customHeaders;

      if (!customHeaders) return false;

      // Headers are stored lowercase in customHeaders
      const headerKey = bypassHeader.toLowerCase();
      const headerValue = customHeaders[headerKey];
      return headerValue === 'true' || headerValue === '1';
    } catch {
      // Context storage not available - bypass header cannot be checked
      return false;
    }
  }

  /**
   * Get TTL for a tool, with metadata taking precedence over defaults.
   */
  private getTtl(cacheMetadata?: boolean | { ttl?: number; slideWindow?: boolean }): number {
    if (typeof cacheMetadata === 'object' && cacheMetadata.ttl !== undefined) {
      return cacheMetadata.ttl;
    }
    return this.options.defaultTTL ?? 60 * 60 * 24;
  }

  @ToolHook.Will('execute', { priority: 1000 })
  async willReadCache(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    // Check bypass header
    if (this.shouldBypassCache(flowCtx)) {
      return;
    }

    const { cache } = toolContext.metadata;

    // Check if tool should be cached (via metadata or tools list)
    // Check both fullName (includes app owner) and name (just namespace:tool) for pattern matching
    if (
      (!this.shouldCacheTool(tool.fullName, cache) && !this.shouldCacheTool(tool.name, cache)) ||
      typeof toolContext.input === 'undefined'
    ) {
      return;
    }

    const cacheStore = this.get(CacheStoreToken);
    const hash = hashObject({ tool: tool.fullName, input: toolContext.input });
    const cached = await cacheStore.getValue(hash);

    if (cached !== undefined && cached !== null) {
      const cacheConfig = typeof cache === 'object' ? cache : undefined;
      if (cache === true || (cacheConfig?.ttl && cacheConfig?.slideWindow)) {
        const ttl = this.getTtl(cache);
        await cacheStore.setValue(hash, cached, ttl);
      }

      /**
       * double check if cache still valid based on tool output schema
       */
      if (!tool.safeParseOutput(cached).success) {
        await cacheStore.delete(hash);
        return;
      }

      /**
       * Add cache metadata to response.
       * Only add _meta if cached value is a plain object (not primitive/array).
       */
      const isPlainObject = typeof cached === 'object' && cached !== null && !Array.isArray(cached);
      let cachedWithMeta: unknown;

      if (isPlainObject) {
        const cachedRecord = cached as Record<string, unknown>;
        const existingMeta = (cachedRecord['_meta'] as Record<string, unknown>) || {};
        cachedWithMeta = {
          ...cachedRecord,
          _meta: {
            ...existingMeta,
            cache: 'hit',
          },
        };
      } else {
        // For primitives and arrays, return as-is (cannot attach _meta)
        cachedWithMeta = cached;
      }

      /**
       * cache hit, set output to the main flow context
       */
      flowCtx.state.rawOutput = cachedWithMeta;

      /**
       * call respond to bypass tool execution
       */
      toolContext.respond(cachedWithMeta);
    }
  }

  @ToolHook.Did('execute', { priority: 1000 })
  async willWriteCache(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    // Check bypass header
    if (this.shouldBypassCache(flowCtx)) {
      return;
    }

    const { cache } = toolContext.metadata;

    // Check if tool should be cached (via metadata or tools list)
    // Check both fullName (includes app owner) and name (just namespace:tool) for pattern matching
    const shouldCache = this.shouldCacheTool(tool.fullName, cache) || this.shouldCacheTool(tool.name, cache);
    if (!shouldCache || typeof toolContext.input === 'undefined') {
      return;
    }

    const cacheStore = this.get(CacheStoreToken);
    const ttl = this.getTtl(cache);

    const hash = hashObject({ tool: tool.fullName, input: toolContext.input });
    await cacheStore.setValue(hash, toolContext.output, ttl);
  }

  /**
   * Check if a tool is cacheable based on metadata or tools list.
   * This can be used by other plugins or flows to determine cacheability.
   */
  isCacheable(toolName: string): boolean {
    return matchesToolPattern(toolName, this.options.toolPatterns ?? []);
  }
}

function hashObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return keys.reduce((acc, key) => {
    acc += key + ':';
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      acc += hashObject(val as Record<string, unknown>);
    } else {
      acc += String(val);
    }
    acc += ';';
    return acc;
  }, '');
}
