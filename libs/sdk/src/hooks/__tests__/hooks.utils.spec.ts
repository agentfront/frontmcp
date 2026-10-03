import 'reflect-metadata';

import { Provider } from '../../common/decorators';
import { type ProviderType } from '../../common/interfaces';
import { ProviderScope, type HookContextRun, type HookEntry, type HookMetadata } from '../../common/metadata';
import { ToolHook } from '../../index';
import ProviderRegistry from '../../provider/provider.registry';
import { bindContextHookTargets, normalizeHooksFromProviders, serverProviderHooks } from '../hooks.utils';

@Provider({ name: 'context-audit', scope: ProviderScope.CONTEXT })
class ContextAudit {
  @ToolHook.Will('execute')
  onInstance() {
    // runs on the run's instance
  }

  @ToolHook.Did('execute')
  static onClass() {
    // runs on the class
  }
}

@Provider({ name: 'global-audit' })
class GlobalAudit {
  @ToolHook.Will('execute')
  audit() {
    // runs on the singleton
  }
}

const RUN = { sessionKey: 'hooks-utils', contextProviders: new Map(), contextSource: {} } as unknown as HookContextRun;

function entry(metadata: Partial<HookMetadata>): Pick<HookEntry, 'metadata'> {
  return {
    metadata: { flow: 'tools:call-tool', stage: 'execute', type: 'will', method: 'm', target: null, ...metadata },
  };
}

describe('normalizeHooksFromProviders', () => {
  it('collects instance hooks of CONTEXT providers with a per-run target, and keeps static hooks as they are', async () => {
    const providers = new ProviderRegistry([ContextAudit, GlobalAudit]);
    await providers.ready;

    const records = normalizeHooksFromProviders(providers);
    const byMethod = new Map(records.map((record) => [record.metadata.method, record.metadata]));

    expect(byMethod.get('onInstance')?.contextTarget).toEqual(expect.any(Function));
    expect(byMethod.get('onClass')?.contextTarget).toBeUndefined();
    expect(byMethod.get('onClass')?.target).toBe(ContextAudit);
    expect(byMethod.get('audit')?.target).toBeInstanceOf(GlobalAudit);
    providers.dispose();
  });

  it('keeps only the given tokens', async () => {
    const providers = new ProviderRegistry([ContextAudit, GlobalAudit]);
    await providers.ready;

    expect(normalizeHooksFromProviders(providers, new Set([GlobalAudit])).map((r) => r.metadata.method)).toEqual([
      'audit',
    ]);
    providers.dispose();
  });
});

describe('serverProviderHooks', () => {
  it('returns nothing when the server declares no providers', async () => {
    const providers = new ProviderRegistry([GlobalAudit]);
    await providers.ready;

    expect(serverProviderHooks(providers, undefined, { kind: 'scope', id: 's', ref: GlobalAudit })).toEqual([]);
    expect(serverProviderHooks(providers, [], { kind: 'scope', id: 's', ref: GlobalAudit })).toEqual([]);
    providers.dispose();
  });

  it('owns the declared providers hooks by the scope', async () => {
    const providers = new ProviderRegistry([GlobalAudit]);
    await providers.ready;
    const owner = { kind: 'scope' as const, id: 's', ref: GlobalAudit };

    const hooks = serverProviderHooks(providers, [GlobalAudit], owner);

    expect(hooks.map((h) => h.metadata.owner)).toEqual([owner]);
    providers.dispose();
  });
});

describe('bindContextHookTargets', () => {
  it('returns the hooks as they are when none is on a CONTEXT provider', async () => {
    const hooks = [entry({ method: 'a' }), entry({ method: 'b' })];
    await expect(bindContextHookTargets(hooks, RUN)).resolves.toEqual(hooks);
  });

  it('binds each CONTEXT provider hook to the instance of the run, and drops one without an instance', async () => {
    const instance = { name: 'instance' };
    const resolved = jest.fn(async () => instance);
    const missing = jest.fn(async () => undefined);
    const plain = entry({ method: 'plain' });

    const bound = await bindContextHookTargets(
      [
        plain,
        entry({ method: 'resolved', contextTarget: resolved }),
        entry({ method: 'missing', contextTarget: missing }),
      ],
      RUN,
    );

    expect(bound.map((hook) => hook.metadata.method)).toEqual(['plain', 'resolved']);
    expect(bound[1].metadata.target).toBe(instance);
    expect(bound[1].metadata.contextTarget).toBeUndefined();
    expect(resolved).toHaveBeenCalledWith(RUN);
  });
});

class ContextClass {}

describe('ProviderRegistry.getContextScopedClasses', () => {
  it('lists the CONTEXT-scoped providers whose class is known', async () => {
    const registry = new ProviderRegistry([
      { name: 'class', provide: ContextClass, useClass: ContextClass, scope: ProviderScope.CONTEXT } as ProviderType,
      ContextAudit,
      {
        name: 'factory',
        provide: Symbol('factory'),
        scope: ProviderScope.CONTEXT,
        inject: () => [] as const,
        useFactory: () => ({}),
      } as ProviderType,
      GlobalAudit,
    ]);
    await registry.ready;

    expect(registry.getContextScopedClasses().map(({ cls }) => cls)).toEqual(
      expect.arrayContaining([ContextClass, ContextAudit]),
    );
    expect(registry.getContextScopedClasses()).toHaveLength(2);
    registry.dispose();
  });
});
