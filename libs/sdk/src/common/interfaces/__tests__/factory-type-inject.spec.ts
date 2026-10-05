import 'reflect-metadata';

import { adapterDiscoveryDeps, normalizeAdapter } from '../../../adapter/adapter.utils';
import { authDiscoveryDeps, normalizeAuth } from '../../../auth/auth.utils';
import { normalizePlugin, pluginDiscoveryDeps } from '../../../plugin/plugin.utils';
import { Adapter } from '../../decorators/adapter.decorator';
import { Plugin } from '../../decorators/plugin.decorator';
import { DynamicAdapter } from '../../dynamic/dynamic.adapter';
import { DynamicPlugin } from '../../dynamic/dynamic.plugin';
import { AdapterKind, AuthProviderKind, PluginKind } from '../../records';
import { annotatedFrontMcpAdaptersSchema, annotatedFrontMcpPluginsSchema } from '../../schemas/annotated-class.schema';
import { type AdapterInterface, type AdapterType } from '../adapter.interface';
import { AsyncAuthProvider, type AuthProviderInterface, type AuthProviderType } from '../auth-provider.interface';
import { type PluginFactoryType, type PluginType } from '../plugin.interface';

class Punctuation {
  readonly mark = '!';
}

@Plugin({ name: 'greeter' })
class GreeterPlugin {}

interface GreeterOptions {
  greeting: string;
}

@Plugin({ name: 'configured-greeter' })
class ConfiguredGreeterPlugin extends DynamicPlugin<GreeterOptions> {
  constructor(readonly options: GreeterOptions) {
    super();
  }
}

interface FeedOptions {
  url: string;
}

@Adapter({ name: 'feed' })
class FeedAdapter extends DynamicAdapter<FeedOptions> {
  constructor(readonly options: { name: string } & FeedOptions) {
    super();
  }

  fetch() {
    return { tools: [] };
  }
}

const emptyAdapter: AdapterInterface = { options: { name: 'empty' }, fetch: () => ({}) };
const staticHeaders: AuthProviderInterface = { headers: () => ({}) };

describe('factory plugins, adapters and auth providers without inject', () => {
  it('accept a plugin factory without inject, which then has no dependencies', () => {
    const plugin: PluginType = { provide: GreeterPlugin, name: 'greeter', useFactory: () => new GreeterPlugin() };

    const record = normalizePlugin(plugin);

    expect(annotatedFrontMcpPluginsSchema.safeParse(plugin).success).toBe(true);
    expect(record.kind === PluginKind.FACTORY && record.inject()).toEqual([]);
    expect(pluginDiscoveryDeps(record)).toEqual([]);
  });

  it('accept DynamicPlugin.init({ useFactory }) without inject', () => {
    const record = normalizePlugin(ConfiguredGreeterPlugin.init({ useFactory: () => ({ greeting: 'hello' }) }));

    expect(record.kind === PluginKind.FACTORY && record.inject()).toEqual([]);
  });

  it('accept an adapter factory without inject, which then has no dependencies', () => {
    const adapter: AdapterType = { provide: Symbol('empty-adapter'), name: 'empty', useFactory: () => emptyAdapter };

    const record = normalizeAdapter(adapter);

    expect(annotatedFrontMcpAdaptersSchema.safeParse(adapter).success).toBe(true);
    expect(record.kind === AdapterKind.FACTORY && record.inject()).toEqual([]);
    expect(adapterDiscoveryDeps(record)).toEqual([]);
  });

  it('accept DynamicAdapter.init({ useFactory }) without inject', () => {
    const record = normalizeAdapter(
      FeedAdapter.init({ name: 'news', useFactory: () => ({ url: 'https://example.com' }) }),
    );

    expect(record.kind === AdapterKind.FACTORY && record.inject()).toEqual([]);
  });

  it('accept an auth provider factory without inject, which then has no dependencies', () => {
    const authProvider: AuthProviderType = {
      provide: Symbol('static-headers'),
      name: 'static-headers',
      useFactory: () => staticHeaders,
    };

    const record = normalizeAuth(authProvider);

    expect(record.kind === AuthProviderKind.FACTORY && record.inject()).toEqual([]);
    expect(authDiscoveryDeps(record)).toEqual([]);
  });

  it('type the factory parameters from inject', () => {
    const plugin: PluginFactoryType<GreeterPlugin, readonly [typeof Punctuation]> = {
      provide: GreeterPlugin,
      name: 'greeter',
      inject: () => [Punctuation] as const,
      // @ts-expect-error -- the parameter is the Punctuation instance inject() resolves
      useFactory: (punctuation) => (punctuation.question ? new GreeterPlugin() : new GreeterPlugin()),
    };
    const authProvider = AsyncAuthProvider({
      provide: Symbol('punctuated-headers'),
      name: 'punctuated-headers',
      inject: () => [Punctuation] as const,
      // @ts-expect-error -- the parameter is the Punctuation instance inject() resolves
      useFactory: (punctuation) => ({ headers: () => ({ mark: punctuation.question }) }),
    });

    expect(plugin.inject?.()).toEqual([Punctuation]);
    expect(authProvider.inject?.()).toEqual([Punctuation]);
  });
});
