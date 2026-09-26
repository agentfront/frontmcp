import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { FlowHooksOf } from '../../common/decorators/hook.decorator';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { type FlowCtxOf } from '../../common/interfaces';
import { annotatedFrontMcpPluginsSchema } from '../../common/schemas/annotated-class.schema';
import { Scope } from '../../scope';
import PluginRegistry, { type PluginScopeInfo } from '../plugin.registry';

const ToolHook = FlowHooksOf('tools:call-tool');
const LABEL_TOKEN = Symbol('factory-label');

interface LabelOptions {
  label: string;
}

let nestedPluginConstructions = 0;

@FrontMcpPlugin({ name: 'factory-nested-check' })
class NestedCheckPlugin {
  constructor() {
    nestedPluginConstructions += 1;
  }
}

@FrontMcpPlugin({ name: 'factory-dynamic', plugins: [NestedCheckPlugin] })
class FactoryDynamicPlugin extends DynamicPlugin<LabelOptions> {
  readonly options: LabelOptions;

  constructor(options: LabelOptions) {
    super();
    this.options = options;
  }

  static override dynamicProviders(options: LabelOptions) {
    return [{ provide: LABEL_TOKEN, useValue: options.label }];
  }

  @ToolHook.Will('execute')
  async gateExecution(_ctx: FlowCtxOf<'tools:call-tool'>) {
    return;
  }
}

async function registerFactoryPlugin() {
  const providers = await createProviderRegistryWithScope();
  const ownScope = providers.get(Scope);
  const scopeInfo: PluginScopeInfo = { ownScope, parentScope: undefined, isStandaloneApp: true };
  const registry = new PluginRegistry(
    providers,
    [FactoryDynamicPlugin.init({ inject: () => [], useFactory: () => ({ label: 'from-factory' }) })],
    undefined,
    scopeInfo,
  );
  await registry.ready;
  return { registry, ownScope };
}

describe('DynamicPlugin.init({ inject, useFactory })', () => {
  beforeEach(() => {
    nestedPluginConstructions = 0;
  });

  it('constructs the plugin class with the options the factory returns', async () => {
    const { registry } = await registerFactoryPlugin();
    const [plugin] = registry.getPlugins();

    expect(plugin).toBeInstanceOf(FactoryDynamicPlugin);
    expect((plugin as FactoryDynamicPlugin).options).toEqual({ label: 'from-factory' });
  });

  it('registers the providers the plugin derives from those options', async () => {
    const { registry } = await registerFactoryPlugin();
    const [plugin] = registry.getPlugins();

    expect(plugin.get(LABEL_TOKEN)).toBe('from-factory');
  });

  it('keeps the nested plugins declared on the @Plugin decorator', async () => {
    await registerFactoryPlugin();

    expect(nestedPluginConstructions).toBe(1);
  });

  it('is accepted by the plugins schema when the factory provides an @Plugin class', () => {
    const factoryPlugin = FactoryDynamicPlugin.init({ inject: () => [], useFactory: () => ({ label: 'x' }) });

    expect(annotatedFrontMcpPluginsSchema.safeParse(factoryPlugin).success).toBe(true);
  });

  it('still rejects a factory whose provide is not an @Plugin class', () => {
    class UnannotatedPlugin {}

    const result = annotatedFrontMcpPluginsSchema.safeParse({
      provide: UnannotatedPlugin,
      inject: () => [],
      useFactory: () => ({}),
    });

    expect(result.success).toBe(false);
  });

  it('registers the hooks declared on the plugin class', async () => {
    const { ownScope } = await registerFactoryPlugin();
    const registerHooks = ownScope.hooks.registerHooks as jest.Mock;
    const registeredMethods = registerHooks.mock.calls.flatMap((call: unknown[]) =>
      call.slice(1).map((hook) => (hook as { metadata: { method?: string } }).metadata.method),
    );

    expect(registeredMethods).toContain('gateExecution');
  });
});

describe('a hand-written factory whose provide is a DynamicPlugin class', () => {
  it('uses the instance the factory returns instead of wrapping it in a second plugin', async () => {
    const providers = await createProviderRegistryWithScope();
    const scopeInfo: PluginScopeInfo = { ownScope: providers.get(Scope), isStandaloneApp: true };
    const produced = new FactoryDynamicPlugin({ label: 'hand-written' });
    const registry = new PluginRegistry(
      providers,
      [{ provide: FactoryDynamicPlugin, name: 'factory-dynamic', inject: () => [], useFactory: () => produced }],
      undefined,
      scopeInfo,
    );
    await registry.ready;
    const [plugin] = registry.getPlugins();

    expect(plugin).toBe(produced);
    expect(produced.options).toEqual({ label: 'hand-written' });
  });
});
