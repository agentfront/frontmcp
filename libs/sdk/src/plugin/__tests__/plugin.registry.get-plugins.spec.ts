import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { type PluginInstance, type PluginRegistryInterface } from '../../common/interfaces';
import PluginRegistry from '../plugin.registry';

const GREETING_TOKEN = Symbol('greeting');

@FrontMcpPlugin({
  name: 'greeting-plugin',
  providers: [{ name: 'greeting', provide: GREETING_TOKEN, inject: () => [], useFactory: () => 'hello' }],
})
class GreetingPlugin {}

async function registerGreetingPlugin(): Promise<PluginRegistryInterface> {
  const providers = await createProviderRegistryWithScope();
  const registry = new PluginRegistry(providers, [GreetingPlugin]);
  await registry.ready;
  return registry;
}

describe('PluginRegistry.getPlugins()', () => {
  it('returns the instance the plugin class constructed, bound to its providers', async () => {
    const registry = await registerGreetingPlugin();

    const [plugin]: PluginInstance[] = registry.getPlugins();

    expect(plugin).toBeInstanceOf(GreetingPlugin);
    expect(plugin.get(GREETING_TOKEN)).toBe('hello');
  });

  it('returns instances without entry metadata, so the names come from getPluginNames()', async () => {
    const registry = await registerGreetingPlugin();

    const [plugin] = registry.getPlugins();

    // @ts-expect-error -- a plugin instance is not a PluginEntry and carries no `metadata`
    expect(plugin.metadata).toBeUndefined();
    expect(registry.getPluginNames()).toEqual(['greeting-plugin']);
  });
});
