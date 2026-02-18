import { DynamicPlugin, Plugin, ProviderType, ResourceType } from '@frontmcp/sdk';
import type { StorePluginOptions } from './store.types';
import { StoreRegistryToken, StoreAccessorToken } from './store.symbols';
import { StoreRegistry } from './providers/store-registry.provider';
import { StoreAccessor } from './providers/store-accessor.provider';
import { generateStoreResourceTemplates } from './store.resources';

/**
 * StorePlugin — Reactive state stores accessible via MCP resources.
 *
 * Provides `this.store` in tools for reading/writing named stores,
 * and exposes store state as `state://` MCP resources.
 *
 * @example
 * ```typescript
 * import StorePlugin, { createValtioStore } from '@frontmcp/plugin-store';
 *
 * const counterStore = createValtioStore({ count: 0 });
 *
 * const server = await ServerRegistry.create('demo', {
 *   plugins: [StorePlugin.init({ stores: { counter: counterStore } })],
 *   resources: StorePlugin.createResources({ counter: counterStore }),
 * });
 * ```
 */
@Plugin({
  name: 'store',
  description: 'Reactive state stores accessible via MCP resources',
  contextExtensions: [
    {
      property: 'store',
      token: StoreAccessorToken,
      errorMessage: 'StorePlugin is not installed. Add StorePlugin.init() to your plugins array.',
    },
  ],
})
export default class StorePlugin extends DynamicPlugin<StorePluginOptions> {
  options: StorePluginOptions;

  constructor(options: StorePluginOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * Dynamic providers based on plugin options.
   */
  static override dynamicProviders = (options: StorePluginOptions): ProviderType[] => {
    const providers: ProviderType[] = [];

    // StoreRegistry provider (singleton, manages all named stores)
    providers.push({
      name: 'store:registry',
      provide: StoreRegistryToken,
      useValue: new StoreRegistry(options.stores ?? {}),
    });

    // StoreAccessor (context-scoped, provides this.store in tools)
    providers.push({
      name: 'store:accessor',
      provide: StoreAccessorToken,
      inject: () => [StoreRegistryToken] as const,
      useFactory: (registry: StoreRegistry) => new StoreAccessor(registry),
    });

    return providers;
  };

  /**
   * Create resource template classes for the given stores.
   * Pass the result to the `resources` array in your server config.
   */
  static createResources(stores: Record<string, unknown>): ResourceType[] {
    const registry = new StoreRegistry(stores as Record<string, import('./store.types').StoreAdapter>);
    return generateStoreResourceTemplates(registry) as unknown as ResourceType[];
  }
}
