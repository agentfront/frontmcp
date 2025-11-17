import { DynamicPlugin, FlowCtxOf, Plugin, ProviderType, ToolHook } from '@frontmcp/sdk';
import CacheRedisProvider from './providers/cache-redis.provider';
import CacheMemoryProvider from './providers/cache-memory.provider';
import { CachePluginOptions } from './cache.types';
import { CacheStoreToken } from './cache.symbol';

@Plugin({
  name: 'cache',
  description: 'Cache plugin for caching tool results',
  providers: [
    /* add providers that always loaded with the plugin or default providers */
    {
      // this is default provider for cache, will be overridden if dynamicProviders based on config
      name: 'cache:memory',
      provide: CacheStoreToken,
      useValue: new CacheMemoryProvider(60 * 60 * 24),
    },
  ],
})
export default class CachePlugin extends DynamicPlugin<CachePluginOptions> {
  private readonly defaultTTL: number;

  static override dynamicProviders = (options: CachePluginOptions) => {
    const providers: ProviderType[] = [];
    switch (options.type) {
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
    const ctx = flowCtx.state.required.toolContext;
    const { cache } = ctx.metadata;
    if (!cache || !ctx.input) {
      return;
    }
    const redis = this.get(CacheStoreToken);
    const hash = hashObject(ctx.input);
    const cached = await redis.getValue(hash);

    if (cache == true || (cache.ttl && cache.slideWindow)) {
      const ttl = cache === true ? this.defaultTTL : cache.ttl ?? this.defaultTTL;
      await redis.setValue(hash, cached, ttl);
    }

    if (cached) {
      console.log('return from cache', { cached });
      ctx.respond({
        ...cached,
        ___cached__: true,
      });
    }
  }

  @ToolHook.Did('execute', { priority: 1000 })
  async willWriteCache(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const ctx = flowCtx.state.required.toolContext;
    const { cache } = ctx.metadata;
    if (!cache) {
      return;
    }
    const redis = this.get(CacheStoreToken);
    console.log('willWriteCache', { cache });
    const ttl = cache === true ? this.defaultTTL : cache.ttl ?? this.defaultTTL;

    const hash = hashObject(ctx.input!);
    await redis.setValue(hash, ctx.output, ttl);
  }
}

function hashObject(obj: any) {
  const keys = Object.keys(obj).sort();
  const values = keys.map((key) => obj[key]);
  return values.reduce((acc, val) => {
    if (typeof val === 'object' && val !== null) {
      acc += hashObject(val);
    } else {
      acc += val;
    }
    return acc;
  }, '');
}
