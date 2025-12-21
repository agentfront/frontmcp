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
  isRedisProvider,
} from '@frontmcp/sdk';
import CacheRedisProvider from './providers/cache-redis.provider';
import CacheMemoryProvider from './providers/cache-memory.provider';
import CacheVercelKvProvider from './providers/cache-vercel-kv.provider';
import { CachePluginOptions, GlobalStoreCachePluginOptions } from './cache.types';
import { CacheStoreToken } from './cache.symbol';

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
                host: storeConfig.host!,
                port: storeConfig.port!,
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

  @ToolHook.Will('execute', { priority: 1000 })
  async willReadCache(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    const { cache } = toolContext.metadata;
    if (!cache || typeof toolContext.input === 'undefined') {
      // no cache or no input, skip
      return;
    }
    const cacheStore = this.get(CacheStoreToken);
    const hash = hashObject({ tool: tool.fullName, input: toolContext.input });
    const cached = await cacheStore.getValue(hash);

    if (cached !== undefined && cached !== null) {
      if (cache === true || (cache.ttl && cache.slideWindow)) {
        const ttl = cache === true ? this.options.defaultTTL : cache.ttl ?? this.options.defaultTTL;
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
       * cache hit, set output to the main flow context
       */
      flowCtx.state.rawOutput = cached;

      /**
       * call respond to bypass tool execution
       */
      toolContext.respond(cached);
    }
  }

  @ToolHook.Did('execute', { priority: 1000 })
  async willWriteCache(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;
    const { cache } = toolContext.metadata;
    if (!cache || typeof toolContext.input === 'undefined') {
      return;
    }
    const cacheStore = this.get(CacheStoreToken);
    const ttl = cache === true ? this.options.defaultTTL : cache.ttl ?? this.options.defaultTTL;

    const hash = hashObject({ tool: tool.fullName, input: toolContext.input });
    await cacheStore.setValue(hash, toolContext.output, ttl);
  }
}

function hashObject(obj: any) {
  const keys = Object.keys(obj).sort();
  return keys.reduce((acc, key) => {
    acc += key + ':';
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      acc += hashObject(val);
    } else {
      acc += val;
    }
    acc += ';';
    return acc;
  }, '');
}
