import 'reflect-metadata';

import { type ProviderType } from '../../common/interfaces';
import { ProviderScope } from '../../common/metadata';
import ProviderRegistry from '../provider.registry';

const LABEL = Symbol('label');
const GREETING = Symbol('greeting');
const SHARED = Symbol('shared');
const SESSION_KEY = 'context-source-session';

function contextProvider(
  provide: symbol,
  useFactory: (...args: string[]) => unknown,
  inject: symbol[] = [],
): ProviderType {
  return {
    name: String(provide.description),
    provide,
    scope: ProviderScope.CONTEXT,
    inject: () => inject,
    useFactory,
  } as ProviderType;
}

describe('ProviderRegistry.buildViews with the registry that built the pre-built providers', () => {
  const registries: ProviderRegistry[] = [];

  async function registry(providers: ProviderType[], parent?: ProviderRegistry): Promise<ProviderRegistry> {
    const created = new ProviderRegistry(providers, parent);
    await created.ready;
    registries.push(created);
    return created;
  }

  async function scopeWithLabel(): Promise<ProviderRegistry> {
    return registry([contextProvider(LABEL, () => 'scope'), contextProvider(SHARED, () => ({ shared: true }))]);
  }

  afterEach(() => {
    for (const created of registries.splice(0)) created.dispose();
  });

  it('builds a CONTEXT provider this registry defines instead of the instance the source pre-built', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(LABEL, () => 'app')], scope);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const appViews = await app.buildViews(SESSION_KEY, scopeViews.context, scope);

    expect(appViews.context.get(LABEL)).toBe('app');
  });

  it('keeps the pre-built instance when no source is given', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(LABEL, () => 'app')], scope);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const appViews = await app.buildViews(SESSION_KEY, scopeViews.context);

    expect(appViews.context.get(LABEL)).toBe('scope');
  });

  it('keeps the pre-built instance of a token only the source defines', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(LABEL, () => 'app')], scope);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const appViews = await app.buildViews(SESSION_KEY, scopeViews.context, scope);

    expect(appViews.context.get(SHARED)).toBe(scopeViews.context.get(SHARED));
  });

  it('builds a CONTEXT provider a registry between this one and the source defines', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(LABEL, () => 'app')], scope);
    const plugin = await registry([], app);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const pluginViews = await plugin.buildViews(SESSION_KEY, scopeViews.context, scope);

    expect(pluginViews.context.get(LABEL)).toBe('app');
  });

  it('resolves a dependency on a CONTEXT provider a registry between this one and the source defines', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(LABEL, () => 'app')], scope);
    const plugin = await registry([contextProvider(GREETING, (label) => `hello ${label}`, [LABEL])], app);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const pluginViews = await plugin.buildViews(SESSION_KEY, scopeViews.context, scope);

    expect(pluginViews.context.get(GREETING)).toBe('hello app');
  });

  it('keeps the pre-built instances when the source is not above this registry', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(LABEL, () => 'app')], scope);
    const unrelated = await registry([]);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const appViews = await app.buildViews(SESSION_KEY, scopeViews.context, unrelated);

    expect(appViews.context.get(LABEL)).toBe('scope');
  });

  it('leaves a GLOBAL provider this registry defines to the registry instead of the pre-built instance', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([{ name: 'label', provide: LABEL, useValue: 'app-global' }], scope);
    const scopeViews = await scope.buildViews(SESSION_KEY);

    const appViews = await app.buildViews(SESSION_KEY, scopeViews.context, scope);

    expect(appViews.context.has(LABEL)).toBe(false);
    expect(app.get(LABEL)).toBe('app-global');
  });

  it('builds a CONTEXT dependency its parent defines when nothing was pre-built', async () => {
    const scope = await scopeWithLabel();
    const app = await registry([contextProvider(GREETING, (label) => `hello ${label}`, [LABEL])], scope);

    const appViews = await app.buildViews(SESSION_KEY);

    expect(appViews.context.get(GREETING)).toBe('hello scope');
  });
});
