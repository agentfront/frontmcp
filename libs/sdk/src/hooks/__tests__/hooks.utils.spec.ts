import 'reflect-metadata';

import { Provider } from '../../common/decorators';
import type { HookEntry, ScopeEntry } from '../../common/entries';
import { type HookType, type ProviderType } from '../../common/interfaces';
import { ProviderScope, type HookContextRun, type HookMetadata } from '../../common/metadata';
import { HookKind, type HookRecord } from '../../common/records';
import { ToolHook } from '../../index';
import ProviderRegistry from '../../provider/provider.registry';
import HookRegistry from '../hook.registry';
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

describe('HookRegistry order', () => {
  const scope = { logger: { child: () => scope.logger } } as unknown as ScopeEntry;

  function hookRegistry(): HookRegistry {
    const providers = { addRegistry: jest.fn(), getActiveScope: () => scope } as unknown as ProviderRegistry;
    return new HookRegistry(providers, []);
  }

  function record(method: string, priority: number, metadata: Partial<HookMetadata> = {}): HookRecord {
    const run = () => undefined;
    const target = { [method]: run } as unknown as HookMetadata['target'];
    return {
      kind: HookKind.METHOD_TOKEN,
      provide: run as unknown as HookType,
      metadata: { flow: 'tools:call-tool', stage: 'execute', type: 'will', method, target, priority, ...metadata },
    };
  }

  const methods = (hooks: HookEntry[]) => hooks.map((hook) => hook.metadata.method);

  it('lists a flow and its stages lowest priority first, in registration order on a tie', async () => {
    const registry = hookRegistry();
    await registry.registerHooks(false, record('a', 10), record('b', 0), record('c', 10), record('d', -5));

    expect(methods(registry.getFlowHooks('tools:call-tool'))).toEqual(['d', 'b', 'a', 'c']);
    expect(methods(registry.getFlowStageHooks('tools:call-tool', 'execute'))).toEqual(['d', 'b', 'a', 'c']);
    expect(methods(registry.getFlowHooksForOwner('tools:call-tool', 'desk'))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('lists the hooks of an entry class lowest priority first', async () => {
    const registry = hookRegistry();
    class EntryClass {}
    const onEntry = (method: string, priority: number) =>
      record(method, priority, { target: EntryClass.prototype as HookMetadata['target'] });
    await registry.registerHooks(true, onEntry('late', 5), onEntry('early', -5));

    expect(methods(registry.getClsHooks(EntryClass))).toEqual(['early', 'late']);
  });

  it('serves inherited hooks in priority order, after its own hooks of the same priority', async () => {
    const parent = hookRegistry();
    const owner = { kind: 'app' as const, id: 'desk', ref: Symbol('desk') };
    await parent.registerHooks(false, record('parent-0', 0, { owner }), record('parent-10', 10, { owner }));
    const child = hookRegistry();
    await child.registerHooks(false, record('own-0', 0), record('own-20', 20));
    child.inheritFrom(parent, 'desk');

    expect(methods(child.getFlowHooksForOwner('tools:call-tool', 'agent'))).toEqual([
      'own-0',
      'parent-0',
      'parent-10',
      'own-20',
    ]);
  });
});
