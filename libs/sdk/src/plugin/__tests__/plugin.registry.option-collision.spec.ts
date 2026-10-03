/**
 * Plugin options that share a name with plugin metadata (#647).
 *
 * `init(options)` spreads the options into the plugin record, and everything in the record but the
 * `provide`/`use*` keys is read as plugin metadata. A plugin with a `tools: { enabled: true }`
 * option (RememberPlugin) therefore handed the registry an object where it expects a list of tools,
 * and startup threw. Options stay the plugin's own; tools a plugin derives from them come from
 * `static dynamicTools`.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { Tool } from '../../common/decorators/tool.decorator';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { ToolContext } from '../../common/interfaces';
import PluginRegistry from '../plugin.registry';

@Tool({
  name: 'option_collision_tool',
  description: 'Contributed by the plugin when its option asks for it',
  inputSchema: {},
})
class ContributedTool extends ToolContext {
  async execute(): Promise<string> {
    return 'ok';
  }
}

interface ToggleOptions {
  tools?: { enabled?: boolean };
  resources?: { limit: number };
}

@FrontMcpPlugin({ name: 'option-collision-toggle' })
class TogglePlugin extends DynamicPlugin<ToggleOptions> {
  readonly options: ToggleOptions;

  constructor(options: ToggleOptions = {}) {
    super();
    this.options = options;
  }

  static override dynamicTools(options: ToggleOptions) {
    return options.tools?.enabled ? [ContributedTool] : [];
  }
}

async function install(record: unknown) {
  const providers = await createProviderRegistryWithScope([]);
  const registry = new PluginRegistry(providers, [record as never]);
  await registry.ready;
  return registry;
}

function toolNames(registry: PluginRegistry): string[] {
  return registry
    .getToolRegistries()
    .flatMap((r) => r.getTools(true))
    .map((t) => t.name);
}

describe('PluginRegistry — options named like plugin metadata (#647)', () => {
  it('starts when an option is an object under a metadata key that expects a list', async () => {
    const registry = await install(TogglePlugin.init({ tools: { enabled: true }, resources: { limit: 3 } }));

    expect(registry.getPluginNames()).toEqual(['option-collision-toggle']);
  });

  it('gives the plugin instance the options it was configured with', () => {
    const record = TogglePlugin.init({ tools: { enabled: true } });

    expect((record as { useValue: TogglePlugin }).useValue.options).toEqual({ tools: { enabled: true } });
  });

  it('registers the tools the plugin contributes for its options', async () => {
    const registry = await install(TogglePlugin.init({ tools: { enabled: true } }));

    expect(toolNames(registry)).toEqual(['option_collision_tool']);
  });

  it('registers no tools when the options do not ask for them', async () => {
    const registry = await install(TogglePlugin.init({ tools: { enabled: false } }));

    expect(toolNames(registry)).toEqual([]);
  });

  it('keeps a list of tools passed under `tools` and adds the contributed ones', async () => {
    @Tool({ name: 'option_collision_extra', description: 'Passed in by the app', inputSchema: {} })
    class ExtraTool extends ToolContext {
      async execute(): Promise<string> {
        return 'extra';
      }
    }
    const record = DynamicPlugin.init.call(TogglePlugin, { tools: [ExtraTool] } as never);

    const registry = await install(record);

    expect(toolNames(registry)).toEqual(['option_collision_extra']);
  });

  it('applies the same rule to a plugin built with useFactory', async () => {
    const record = TogglePlugin.init({
      inject: () => [] as const,
      useFactory: () => ({ tools: { enabled: true } }),
      tools: { enabled: true },
    } as never);

    expect((record as { tools?: unknown }).tools).toBeUndefined();
  });

  describe('tools contributed for the options a useFactory returns (#678)', () => {
    it('registers them', async () => {
      const registry = await install(
        TogglePlugin.init({ inject: () => [] as const, useFactory: () => ({ tools: { enabled: true } }) }),
      );

      expect(toolNames(registry)).toEqual(['option_collision_tool']);
    });

    it('registers none when the options do not ask for them', async () => {
      const registry = await install(
        TogglePlugin.init({ inject: () => [] as const, useFactory: () => ({ tools: { enabled: false } }) }),
      );

      expect(toolNames(registry)).toEqual([]);
    });
  });

  describe('an option named `providers` (#678)', () => {
    const LABEL_TOKEN = Symbol('option-collision-label');

    interface ProvidersOptions {
      providers?: { a: number };
      label?: string;
    }

    @FrontMcpPlugin({ name: 'option-collision-providers' })
    class ProvidersOptionPlugin extends DynamicPlugin<ProvidersOptions> {
      readonly options: ProvidersOptions;

      constructor(options: ProvidersOptions = {}) {
        super();
        this.options = options;
      }

      static override dynamicProviders(options: ProvidersOptions) {
        return [{ name: 'label', provide: LABEL_TOKEN, useValue: options.label ?? 'default' }];
      }
    }

    it('builds the record when the option is an object', () => {
      expect(() => ProvidersOptionPlugin.init({ providers: { a: 1 } })).not.toThrow();
    });

    it('gives the plugin instance the option and keeps the providers it derives from its options', () => {
      const record = ProvidersOptionPlugin.init({ providers: { a: 1 }, label: 'configured' }) as {
        useValue: ProvidersOptionPlugin;
        providers?: { provide: unknown; useValue: unknown }[];
      };

      expect(record.useValue.options).toEqual({ providers: { a: 1 }, label: 'configured' });
      expect(record.providers).toEqual([expect.objectContaining({ provide: LABEL_TOKEN, useValue: 'configured' })]);
    });

    it('starts and resolves the providers the plugin derives from its options', async () => {
      const registry = await install(ProvidersOptionPlugin.init({ providers: { a: 1 }, label: 'started' }));
      const [plugin] = registry.getPlugins();

      expect(plugin.get(LABEL_TOKEN)).toBe('started');
    });

    it('starts when the plugin is built with useFactory and the factory returns the option', async () => {
      const registry = await install(
        ProvidersOptionPlugin.init({
          inject: () => [] as const,
          useFactory: () => ({ providers: { a: 2 }, label: 'from-factory' }),
        }),
      );
      const [plugin] = registry.getPlugins();

      expect((plugin as unknown as ProvidersOptionPlugin).options).toEqual({
        providers: { a: 2 },
        label: 'from-factory',
      });
      expect(plugin.get(LABEL_TOKEN)).toBe('from-factory');
    });

    it('types `providers` as the option when the plugin has one, and as extra providers otherwise', () => {
      const PROVIDED = Symbol('option-collision-typed');
      const extra = [{ name: 'typed', provide: PROVIDED, useValue: 1 }];

      expect(() => {
        ProvidersOptionPlugin.init({ providers: { a: 1 } });
        // @ts-expect-error -- the plugin's own `providers` option is an object, not a provider list
        ProvidersOptionPlugin.init({ providers: extra });
        TogglePlugin.init({ providers: extra });
        // @ts-expect-error -- without an option of that name, `providers` is a list of providers
        TogglePlugin.init({ providers: { a: 1 } });
      }).not.toThrow();
    });

    it('still adds a list of providers passed under `providers`', async () => {
      const EXTRA_TOKEN = Symbol('option-collision-extra');
      const record = DynamicPlugin.init.call(ProvidersOptionPlugin, {
        providers: [{ name: 'extra', provide: EXTRA_TOKEN, useValue: 'extra' }],
      } as never);

      const registry = await install(record);
      const [plugin] = registry.getPlugins();

      expect(plugin.get(EXTRA_TOKEN)).toBe('extra');
      expect(plugin.get(LABEL_TOKEN)).toBe('default');
    });
  });

  it('keeps options named like the other list-valued metadata keys out of the record', async () => {
    const record = DynamicPlugin.init.call(TogglePlugin, {
      contextExtensions: { a: 1 },
      enforcesMetadata: { b: 2 },
    } as never) as unknown as Record<string, unknown> & { useValue: TogglePlugin };

    expect(record['contextExtensions']).toBeUndefined();
    expect(record['enforcesMetadata']).toBeUndefined();
    expect(record.useValue.options).toEqual({ contextExtensions: { a: 1 }, enforcesMetadata: { b: 2 } });
    expect((await install(record)).getPluginNames()).toEqual(['option-collision-toggle']);
  });
});
