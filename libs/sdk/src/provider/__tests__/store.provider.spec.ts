import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Token } from '@frontmcp/di';
import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import { App, LogLevel, ProviderScope, type ProviderType } from '../../common';
import { StoreNotOpenedInBuildError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { sqliteStorageProvider } from '../../storage/sqlite-storage.provider';
import { createContainer } from '../create-container';
import { storeProvider } from '../store.provider';

interface KeyValueStore {
  get(key: string): string;
}

const StoreToken: Token<KeyValueStore> = Symbol('kv-store');
const ConsumerToken: Token<{ store: KeyValueStore }> = Symbol('kv-consumer');

@App({ name: 'store-app' })
class StoreApp {}

function serverWith(providers: ProviderType[]) {
  return {
    info: { name: 'store-provider', version: '1.0.0' },
    apps: [StoreApp],
    logging: { level: LogLevel.Off },
    providers,
  };
}

function storeProviders(open: () => KeyValueStore): ProviderType[] {
  return [
    storeProvider({ name: 'kv:store', provide: StoreToken, inject: () => [] as const, useFactory: open }),
    {
      name: 'kv:consumer',
      provide: ConsumerToken,
      scope: ProviderScope.GLOBAL,
      inject: () => [StoreToken] as const,
      useFactory: (store: KeyValueStore) => ({ store }),
    },
  ];
}

describe('storeProvider()', () => {
  it('returns the provider as given, with its factory', () => {
    const useFactory = () => ({ get: () => 'value' });
    const provider = { name: 'kv:store', provide: StoreToken, useFactory };

    expect(storeProvider(provider)).toBe(provider);
    expect(provider.useFactory).toBe(useFactory);
  });

  it("does not build the store in a build's boot, and gives what injects it a stand-in that refuses every call", async () => {
    const open = jest.fn(() => ({ get: () => 'value' }));
    const instance = await FrontMcpInstance.createForManifest(serverWith(storeProviders(open)));
    const [scope] = instance.getScopes() as Scope[];
    const { store } = scope.providers.get(ConsumerToken);

    expect(open).not.toHaveBeenCalled();
    expect(await Promise.resolve(store)).toBe(store);
    expect(() => store.get('key')).toThrow(StoreNotOpenedInBuildError);
    expect(() => store.get('key')).toThrow(
      'kv:store is not opened while a build reads the server: it opens when the server starts',
    );
    await instance.shutdown();
  });

  it('builds the store on a server that starts, and in a container', async () => {
    const open = jest.fn(() => ({ get: () => 'value' }));
    const server = await FrontMcpInstance.createForGraph(serverWith(storeProviders(open)));
    const [scope] = server.getScopes() as Scope[];
    expect(scope.providers.get(ConsumerToken).store.get('key')).toBe('value');
    await server.shutdown();

    const container = await createContainer({ providers: storeProviders(open), logging: { level: LogLevel.Off } });
    expect(container.get(ConsumerToken).store.get('key')).toBe('value');
    await container.dispose();

    expect(open).toHaveBeenCalledTimes(2);
  });

  it("opens no SQLite file for sqliteStorageProvider() in a build's boot", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'store-provider-'));
    try {
      const path = join(dir, 'app.sqlite');
      const instance = await FrontMcpInstance.createForManifest(serverWith([sqliteStorageProvider({ path })]));
      await instance.shutdown();

      expect(await fileExists(path)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
