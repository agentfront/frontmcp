/**
 * A plugin listed as its class is configured with the options `init()` uses when given none (#803).
 *
 * `plugins: [SomePlugin]` (a CLASS_TOKEN record) and `{ provide, useClass: SomePlugin }` (a CLASS
 * record) got neither the providers nor the tools a `DynamicPlugin` derives from its options. A
 * plugin whose tools exist only in `static dynamicTools` (CodeCall) installed no tools while its
 * hooks still ran, and one whose services come from `static dynamicProviders` failed on the first
 * request that needed them.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { Tool } from '../../common/decorators/tool.decorator';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { ToolContext, type PluginType, type ProviderType } from '../../common/interfaces';
import PluginRegistry from '../plugin.registry';

const CONFIG_TOKEN = Symbol('class-form:config');

interface MetaOptions {
  topK?: number;
  withExtraTool?: boolean;
}

const hookOptions: MetaOptions[] = [];

@Tool({ name: 'meta_search', description: 'Searches the catalog', inputSchema: {} })
class MetaSearchTool extends ToolContext {
  async execute(): Promise<string> {
    return 'ok';
  }
}

@Tool({ name: 'meta_extra', description: 'Only with withExtraTool', inputSchema: {} })
class MetaExtraTool extends ToolContext {
  async execute(): Promise<string> {
    return 'ok';
  }
}

@FrontMcpPlugin({ name: 'class-form-meta' })
class MetaToolsPlugin extends DynamicPlugin<MetaOptions> {
  readonly options: MetaOptions;

  constructor(options: MetaOptions = {}) {
    super();
    this.options = options;
  }

  static override dynamicProviders(options: MetaOptions): ProviderType[] {
    hookOptions.push(options);
    return [{ name: 'class-form:config', provide: CONFIG_TOKEN, useValue: { topK: options.topK ?? 8 } }];
  }

  static override dynamicTools(options: MetaOptions) {
    return options.withExtraTool ? [MetaSearchTool, MetaExtraTool] : [MetaSearchTool];
  }
}

@FrontMcpPlugin({ name: 'class-form-plain' })
class PlainPlugin {}

/** A plugin built against another copy of the SDK: its `DynamicPlugin` is not this one. */
@FrontMcpPlugin({ name: 'class-form-foreign' })
class ForeignCopyPlugin {
  constructor(readonly options?: MetaOptions) {}

  static dynamicTools(_options: MetaOptions) {
    return [MetaSearchTool];
  }
}

class RequiredOptionError extends Error {}

@FrontMcpPlugin({ name: 'class-form-required' })
class RequiredOptionPlugin extends DynamicPlugin<{ adapter: string }> {
  static override dynamicProviders(options: Partial<{ adapter: string }>): ProviderType[] {
    if (!options.adapter) throw new RequiredOptionError('RequiredOptionPlugin.init() requires an `adapter` option');
    return [];
  }
}

async function install(plugin: PluginType) {
  const providers = await createProviderRegistryWithScope([]);
  const registry = new PluginRegistry(providers, [plugin]);
  await registry.ready;
  return registry;
}

function toolNames(registry: PluginRegistry): string[] {
  return registry
    .getToolRegistries()
    .flatMap((r) => r.getTools(true))
    .map((t) => t.name)
    .sort();
}

describe('PluginRegistry — a dynamic plugin listed as its class (#803)', () => {
  beforeEach(() => {
    hookOptions.length = 0;
  });

  it('installs the tools init() installs, from plugins: [SomePlugin]', async () => {
    const classForm = await install(MetaToolsPlugin);
    const initForm = await install(MetaToolsPlugin.init());

    expect(toolNames(classForm)).toEqual(['meta_search']);
    expect(toolNames(classForm)).toEqual(toolNames(initForm));
  });

  it('registers the providers the default options give', async () => {
    const registry = await install(MetaToolsPlugin);
    const [plugin] = registry.getPlugins();

    expect(plugin).toBeInstanceOf(MetaToolsPlugin);
    expect(plugin.get(CONFIG_TOKEN)).toEqual({ topK: 8 });
  });

  it('builds the plugin and reads its static hooks with the options init() uses when given none', async () => {
    const registry = await install(MetaToolsPlugin);
    const [plugin] = registry.getPlugins();

    expect(hookOptions).toEqual([{}]);
    expect((plugin as MetaToolsPlugin).options).toBe(hookOptions[0]);
  });

  it('recognises the static hooks on a class that does not extend this copy of DynamicPlugin', async () => {
    const registry = await install(ForeignCopyPlugin);
    const [plugin] = registry.getPlugins();

    expect(toolNames(registry)).toEqual(['meta_search']);
    expect((plugin as ForeignCopyPlugin).options).toEqual({});
  });

  it('does the same for a { provide, useClass } record', async () => {
    const registry = await install({ provide: 'class-form-meta', useClass: MetaToolsPlugin } as never);
    const [plugin] = registry.getPlugins();

    expect(toolNames(registry)).toEqual(['meta_search']);
    expect(plugin.get(CONFIG_TOKEN)).toEqual({ topK: 8 });
  });

  it('leaves a plugin without static hooks as it was', async () => {
    const registry = await install(PlainPlugin);

    expect(registry.getPluginNames()).toEqual(['class-form-plain']);
    expect(registry.getPlugins()[0]).toBeInstanceOf(PlainPlugin);
    expect(toolNames(registry)).toEqual([]);
  });

  it("fails at startup with the plugin's own error when it needs options", async () => {
    await expect(install(RequiredOptionPlugin)).rejects.toThrow(RequiredOptionError);
  });
});
