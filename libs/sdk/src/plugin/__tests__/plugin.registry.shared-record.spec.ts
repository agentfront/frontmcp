/**
 * One `SomePlugin.init(options)` record installed by several registries (#647).
 *
 * An app class with `plugins: [CachePlugin.init(...)]` used by two servers hands both the same
 * record, and so the same plugin instance: `get` was rebound to whichever registry installed it
 * last, so the first server's hooks resolved the last server's providers. The first registry keeps
 * the configured instance; every later one builds its own from the same options, so each has its
 * own `get`, its own fields (ES `#private` ones too) and its own state.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { FlowHooksOf } from '../../common/decorators/hook.decorator';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { Scope } from '../../scope';
import PluginRegistry from '../plugin.registry';

const ToolHook = FlowHooksOf('tools:call-tool');
const LABEL = Symbol('shared-record-label');

interface CounterOptions {
  prefix: string;
}

@FrontMcpPlugin({ name: 'shared-record-counter' })
class CounterPlugin extends DynamicPlugin<CounterOptions> {
  #calls = 0;
  readonly seen = new Map<string, number>();
  readonly options: CounterOptions;
  declare get: <T>(token: symbol) => T;

  constructor(options: CounterOptions) {
    super();
    this.options = options;
  }

  @ToolHook.Will('execute')
  count(): string {
    this.#calls += 1;
    const label = `${this.options.prefix}${String(this.get(LABEL))}`;
    this.seen.set(label, this.#calls);
    return label;
  }

  calls(): number {
    return this.#calls;
  }
}

type Installed = { plugin: CounterPlugin; hook: { metadata: { target: CounterPlugin } } };

async function install(record: unknown, label: string): Promise<Installed> {
  const providers = await createProviderRegistryWithScope([{ provide: LABEL, useValue: label, name: 'label' }]);
  const registry = new PluginRegistry(providers, [record as never]);
  await registry.ready;
  const registerHooks = providers.get(Scope).hooks.registerHooks as jest.Mock;
  const [hook] = registerHooks.mock.calls[0].slice(1) as Installed['hook'][];
  return { plugin: registry.getPlugins()[0] as unknown as CounterPlugin, hook };
}

describe('PluginRegistry — one init() record installed by several registries (#647)', () => {
  it('keeps the configured instance for the first registry', async () => {
    const record = CounterPlugin.init({ prefix: 'a:' });

    const { plugin } = await install(record, 'first');

    expect(plugin).toBe((record as { useValue: CounterPlugin }).useValue);
  });

  it('builds an instance of its own, from the same options, for every later registry', async () => {
    const record = CounterPlugin.init({ prefix: 'b:' });
    const first = await install(record, 'first');
    const second = await install(record, 'second');

    expect(second.plugin).not.toBe(first.plugin);
    expect(second.plugin).toBeInstanceOf(CounterPlugin);
    expect(second.plugin.options).toEqual({ prefix: 'b:' });
  });

  it('resolves providers from its own registry after another registry installs the same record', async () => {
    const record = CounterPlugin.init({ prefix: 'c:' });
    const first = await install(record, 'first');
    const second = await install(record, 'second');

    expect([first.plugin.get(LABEL), second.plugin.get(LABEL)]).toEqual(['first', 'second']);
    expect([first.hook.metadata.target.count(), second.hook.metadata.target.count()]).toEqual(['c:first', 'c:second']);
  });

  it('keeps ES private fields and mutable state per registry', async () => {
    const record = CounterPlugin.init({ prefix: 'd:' });
    const first = await install(record, 'first');
    const second = await install(record, 'second');

    first.hook.metadata.target.count();
    first.hook.metadata.target.count();
    second.hook.metadata.target.count();

    expect([first.plugin.calls(), second.plugin.calls()]).toEqual([2, 1]);
    expect([[...first.plugin.seen.keys()], [...second.plugin.seen.keys()]]).toEqual([['d:first'], ['d:second']]);
  });

  it('runs a hook that reads an ES private field when a single registry installs the plugin', async () => {
    const { hook, plugin } = await install(CounterPlugin.init({ prefix: 'e:' }), 'only');

    expect(hook.metadata.target.count()).toBe('e:only');
    expect(plugin.calls()).toBe(1);
  });

  it('keeps a hand-written value record as the instance it names', async () => {
    const value = new CounterPlugin({ prefix: 'f:' });

    const { plugin } = await install({ provide: CounterPlugin, useValue: value, name: 'shared-record-counter' }, 'x');

    expect(plugin).toBe(value);
  });
});
