/**
 * `mergeFromRegistry(..., visibleBelow)`: providers merged into a registry for part of its subtree
 * only (what a plugin installed on one app contributes to the scope). The registry's own lookups
 * (the flows a scope runs) and that subtree resolve them; the rest of the subtree does not (#678).
 */
import 'reflect-metadata';

import { type ProviderRecord } from '@frontmcp/di';

import { type ProviderType } from '../../common/interfaces';
import { ProviderScope } from '../../common/metadata';
import ProviderRegistry from '../provider.registry';
import { normalizeProvider } from '../provider.utils';

const STORE = Symbol('store');
const SESSION = Symbol('session');
const DEPENDENT = Symbol('dependent');
const SESSION_KEY = 'visibility-session';

function exportOf(registry: ProviderRegistry, providers: ProviderType[]) {
  return providers.map((provider) => {
    const def = normalizeProvider(provider) as ProviderRecord;
    return { token: def.provide, def, instance: registry.getAllSingletons().get(def.provide) as never };
  });
}

describe('ProviderRegistry visibility of merged providers', () => {
  const created: ProviderRegistry[] = [];

  async function registry(providers: ProviderType[], parent?: ProviderRegistry): Promise<ProviderRegistry> {
    const r = new ProviderRegistry(providers, parent);
    await r.ready;
    created.push(r);
    return r;
  }

  afterEach(() => {
    for (const r of created.splice(0)) r.dispose();
  });

  const pluginProviders: ProviderType[] = [
    { name: 'store', provide: STORE, useValue: { owner: 'billing' } },
    {
      name: 'session',
      provide: SESSION,
      scope: ProviderScope.CONTEXT,
      inject: () => [] as const,
      useFactory: () => ({ owner: 'billing' }),
    } as ProviderType,
  ];

  /** A scope with two apps; a plugin on `billing` merged its providers into the scope for billing only. */
  async function scopeWithTwoApps() {
    const scope = await registry([]);
    const billing = await registry([], scope);
    const support = await registry([], scope);
    const plugin = await registry(pluginProviders, billing);
    scope.mergeFromRegistry(plugin, exportOf(plugin, pluginProviders), billing);
    return { scope, billing, support, plugin };
  }

  it('lets the registry itself and the subtree it was merged for resolve them', async () => {
    const { scope, billing, plugin } = await scopeWithTwoApps();

    expect(scope.get(STORE)).toEqual({ owner: 'billing' });
    expect(billing.get(STORE)).toEqual({ owner: 'billing' });
    expect(plugin.get(STORE)).toEqual({ owner: 'billing' });
  });

  it('hides them from the rest of the subtree', async () => {
    const { support } = await scopeWithTwoApps();

    expect(() => support.get(STORE)).toThrow();
    expect(() => support.get(SESSION)).toThrow();
  });

  it('drops them from the views another app builds from the scope', async () => {
    const { scope, billing, support } = await scopeWithTwoApps();
    const scopeViews = await scope.buildViews(SESSION_KEY);
    expect(scopeViews.context.has(SESSION)).toBe(true);

    const supportViews = await support.buildViews(SESSION_KEY, scopeViews.context, scope);
    const billingViews = await billing.buildViews(SESSION_KEY, scopeViews.context, scope);

    expect(supportViews.context.has(SESSION)).toBe(false);
    expect(billingViews.context.get(SESSION)).toEqual({ owner: 'billing' });
  });

  it('fails a provider of another app that depends on them', async () => {
    const { support } = await scopeWithTwoApps();
    const dependent = {
      name: 'dependent',
      provide: DEPENDENT,
      scope: ProviderScope.CONTEXT,
      inject: () => [SESSION] as const,
      useFactory: (session: unknown) => ({ session }),
    } as ProviderType;

    const supportPlugin = await registry([dependent], support);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(supportPlugin.buildViews(SESSION_KEY)).rejects.toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps a definition every registry below already resolves', async () => {
    const scope = await registry([{ name: 'store', provide: STORE, useValue: { owner: 'server' } }]);
    const billing = await registry([], scope);
    const support = await registry([], scope);
    const plugin = await registry(pluginProviders, billing);

    scope.mergeFromRegistry(plugin, exportOf(plugin, pluginProviders), billing);

    expect(support.get(STORE)).toEqual({ owner: 'server' });
    expect(scope.get(STORE)).toEqual({ owner: 'server' });
  });

  it('lifts the restriction when the same token is merged for the whole subtree', async () => {
    const { scope, support, plugin } = await scopeWithTwoApps();

    scope.mergeFromRegistry(plugin, exportOf(plugin, pluginProviders));

    expect(support.get(STORE)).toEqual({ owner: 'billing' });
  });

  it('lets every app a token was merged for resolve it', async () => {
    const { scope, support } = await scopeWithTwoApps();
    const supportPlugin = await registry(pluginProviders, support);

    scope.mergeFromRegistry(supportPlugin, exportOf(supportPlugin, pluginProviders), support);

    expect(support.get(STORE)).toEqual({ owner: 'billing' });
  });

  it('finds the child of an ancestor a registry sits under', async () => {
    const { scope, billing, plugin } = await scopeWithTwoApps();
    const other = await registry([]);

    expect(plugin.subtreeBelow(scope)).toBe(billing);
    expect(billing.subtreeBelow(scope)).toBe(billing);
    expect(plugin.subtreeBelow(other)).toBeUndefined();
  });
});
