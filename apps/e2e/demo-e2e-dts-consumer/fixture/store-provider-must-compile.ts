import 'reflect-metadata';

import {
  DynamicPlugin,
  FrontMcpConfig,
  Plugin,
  StoreNotOpenedInBuildError,
  storeProvider,
  type FrontMcpConfigType,
  type ProviderType,
} from '@frontmcp/sdk';

interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
}

const KeyValueStoreToken = Symbol('kv-store');

interface KvOptions {
  url?: string;
}

@Plugin({ name: 'kv' })
export class KvPlugin extends DynamicPlugin<KvOptions> {
  static override dynamicProviders = (options: KvOptions): ProviderType[] => [
    storeProvider({
      name: 'kv:store',
      provide: KeyValueStoreToken,
      inject: () => [FrontMcpConfig] as const,
      useFactory: (config: FrontMcpConfigType): KeyValueStore => ({
        get: async (key) => `${options.url ?? config.info.name}/${key}`,
      }),
    }),
  ];
}

export const unopenedStore: string = new StoreNotOpenedInBuildError('kv:store').store;

// @ts-expect-error a store is a factory provider
storeProvider({ name: 'kv:store', provide: KeyValueStoreToken, useValue: {} });
