/**
 * Hook order: the `HookPhase` bands, `before` / `after` constraints within a stage, the boot check that refuses a
 * cycle and warns about a target no hook matches, and the validation of the hook options.
 */
import 'reflect-metadata';

import { FlowHooksOf, FrontMcpFlowHookTokens, HookPhase, type HookMetadata } from '../../common';
import { HookOrderCycleError, InvalidDecoratorMetadataError } from '../../errors';
import { sortStageMap, type StageEntry, type StageMap } from '../../flows/flow.stages';
import { checkHookOrder } from '../hook-order';

class SetupGatePlugin {}
class FeatureGatePlugin {}
class AuditPlugin {}
class TenantProvider {}

interface HookSpec {
  target: object;
  method?: string;
  pluginName?: string;
  priority?: number;
  before?: string[];
  after?: string[];
  type?: HookMetadata['type'];
  stage?: string;
}

function hookOf(spec: HookSpec): HookMetadata {
  return {
    flow: 'tools:call-tool',
    stage: spec.stage ?? 'execute',
    type: spec.type ?? 'will',
    method: spec.method ?? 'run',
    target: spec.target as HookMetadata['target'],
    pluginName: spec.pluginName,
    priority: spec.priority ?? 0,
    before: spec.before,
    after: spec.after,
  };
}

/** The ids of `specs` in the order a stage runs them, registered in the order given. */
function runOrder(...specs: HookSpec[]): string[] {
  const entries: StageEntry<unknown>[] = specs.map((spec, index) => ({
    hook: hookOf(spec),
    _priority: spec.priority ?? 0,
    _order: index,
    method: async () => undefined,
  }));
  const table: StageMap<unknown> = { willExecute: entries };
  sortStageMap(table);
  return table['willExecute'].map(({ hook }) => `${hook.pluginName ?? hook.target?.constructor.name}.${hook.method}`);
}

describe('HookPhase', () => {
  it('names priorities from resolve to shape, lowest first, with the default 0 between resolve and guard', () => {
    expect(HookPhase).toEqual({ resolve: -100, guard: 100, observe: 300, shape: 500 });
    expect(HookPhase.resolve).toBeLessThan(0);
    expect(HookPhase.guard).toBeGreaterThan(0);
  });

  it('leaves room to run a hook between two bands', () => {
    expect(
      runOrder(
        { target: new AuditPlugin(), pluginName: 'audit', priority: HookPhase.observe },
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: HookPhase.guard + 10 },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', priority: HookPhase.guard },
      ),
    ).toEqual(['feature-gate.run', 'setup-gate.run', 'audit.run']);
  });
});

describe('before / after within a stage', () => {
  it('runs a hook before the plugin its before names, whatever their priorities', () => {
    expect(
      runOrder(
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: -10 },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', priority: 10, before: ['setup-gate'] },
      ),
    ).toEqual(['feature-gate.run', 'setup-gate.run']);
  });

  it('runs a hook after the class its after names', () => {
    expect(
      runOrder(
        { target: new AuditPlugin(), pluginName: 'audit', priority: -10, after: ['TenantProvider'] },
        { target: new TenantProvider(), priority: 10 },
      ),
    ).toEqual(['TenantProvider.run', 'audit.run']);
  });

  it("names one hook of a plugin with .method, and leaves the plugin's other hooks where priority puts them", () => {
    expect(
      runOrder(
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', method: 'early', priority: 0 },
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', method: 'late', priority: 5 },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', priority: 10, before: ['setup-gate.late'] },
      ),
    ).toEqual(['setup-gate.early', 'feature-gate.run', 'setup-gate.late']);
  });

  it('matches a plugin hook by its class name too', () => {
    expect(
      runOrder(
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: -10 },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', after: ['SetupGatePlugin.run'], priority: -20 },
      ),
    ).toEqual(['setup-gate.run', 'feature-gate.run']);
  });

  it('keeps priority, then registration order, for the hooks no constraint relates', () => {
    expect(
      runOrder(
        { target: new AuditPlugin(), pluginName: 'audit', priority: 0 },
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: 0 },
        { target: new TenantProvider(), priority: -5 },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', priority: 20, before: ['setup-gate'] },
      ),
    ).toEqual(['TenantProvider.run', 'audit.run', 'feature-gate.run', 'setup-gate.run']);
  });

  it('ignores a constraint that names the hook itself, or another instance of the same hook', () => {
    expect(
      runOrder(
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: 1, before: ['setup-gate'] },
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: 0, before: ['setup-gate'] },
      ),
    ).toEqual(['setup-gate.run', 'setup-gate.run']);
  });

  it('does nothing for a target that matches no hook of the stage', () => {
    expect(
      runOrder(
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', priority: -10 },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', priority: 10, before: ['cache'] },
      ),
    ).toEqual(['setup-gate.run', 'feature-gate.run']);
  });

  it('throws a HookOrderCycleError that names the hooks in a cycle', () => {
    let thrown: unknown;
    try {
      runOrder(
        { target: new AuditPlugin(), pluginName: 'audit' },
        { target: new SetupGatePlugin(), pluginName: 'setup-gate', before: ['feature-gate'] },
        { target: new FeatureGatePlugin(), pluginName: 'feature-gate', before: ['setup-gate.run'] },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HookOrderCycleError);
    const cycle = thrown as HookOrderCycleError;
    expect(cycle.hooks).toEqual(['setup-gate.run', 'feature-gate.run']);
    expect(cycle.message).toBe(
      "The before/after options of the will hooks on 'execute' of 'tools:call-tool' form a cycle: " +
        'setup-gate.run → feature-gate.run → setup-gate.run. Remove one of these constraints.',
    );
  });
});

describe('checkHookOrder', () => {
  it('throws a HookOrderCycleError for a cycle among the hooks of one stage', () => {
    const hooks = [
      hookOf({ target: new SetupGatePlugin(), pluginName: 'setup-gate', after: ['feature-gate'] }),
      hookOf({ target: new FeatureGatePlugin(), pluginName: 'feature-gate', after: ['setup-gate'] }),
    ];

    expect(() => checkHookOrder(hooks, () => undefined)).toThrow(HookOrderCycleError);
  });

  it('relates only the hooks of the same flow, stage and type', () => {
    const hooks = [
      hookOf({ target: new SetupGatePlugin(), pluginName: 'setup-gate', after: ['feature-gate'] }),
      hookOf({ target: new FeatureGatePlugin(), pluginName: 'feature-gate', type: 'did', after: ['setup-gate'] }),
    ];
    const warnings: string[] = [];

    checkHookOrder(hooks, (message) => warnings.push(message));

    expect(warnings).toEqual([
      "Hook setup-gate.run (will 'execute' of 'tools:call-tool') names 'feature-gate' in after, " +
        'but no hook on that stage matches it, so it changes nothing. A target is a plugin name or the class ' +
        'that declares the hook, optionally followed by .method.',
      "Hook feature-gate.run (did 'execute' of 'tools:call-tool') names 'setup-gate' in after, " +
        'but no hook on that stage matches it, so it changes nothing. A target is a plugin name or the class ' +
        'that declares the hook, optionally followed by .method.',
    ]);
  });

  it('warns once per hook, naming every target of it that matches nothing', () => {
    const declared = { pluginName: 'feature-gate', before: ['cache', 'setup-gate'], after: ['tenant'] };
    const hooks = [
      hookOf({ target: new SetupGatePlugin(), pluginName: 'setup-gate' }),
      hookOf({ target: new FeatureGatePlugin(), ...declared }),
      hookOf({ target: new FeatureGatePlugin(), ...declared }),
    ];
    const warnings: string[] = [];

    checkHookOrder(hooks, (message) => warnings.push(message));

    expect(warnings).toEqual([
      "Hook feature-gate.run (will 'execute' of 'tools:call-tool') names 'cache' in before and 'tenant' in after, " +
        'but no hook on that stage matches them, so they change nothing. A target is a plugin name or the class ' +
        'that declares the hook, optionally followed by .method.',
    ]);
  });

  it('says nothing about hooks whose constraints all match', () => {
    const hooks = [
      hookOf({ target: new SetupGatePlugin(), pluginName: 'setup-gate' }),
      hookOf({ target: new FeatureGatePlugin(), pluginName: 'feature-gate', before: ['SetupGatePlugin'] }),
    ];
    const warn = jest.fn();

    checkHookOrder(hooks, warn);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('hook option validation', () => {
  const ToolHook = FlowHooksOf('tools:call-tool');

  it.each([
    [{ appliesTo: 'everywhere' }, 'appliesTo'],
    [{ before: 'setup-gate' }, 'before'],
    [{ after: [''] }, 'after'],
    [{ before: [42] }, 'before'],
  ])('refuses %j where the hook is declared', (options, field) => {
    const invalid = options as Parameters<typeof ToolHook.Will>[1];

    expect(() => ToolHook.Will('execute', invalid)).toThrow(InvalidDecoratorMetadataError);
    expect(() => ToolHook.Will('execute', invalid)).toThrow(`"${field}"`);
  });

  it('keeps valid before, after and appliesTo on the hook metadata', () => {
    class OrderedPlugin {
      @ToolHook.Will('execute', { before: ['setup-gate'], after: ['TenantProvider.load'], appliesTo: 'all-apps' })
      run() {
        return undefined;
      }
    }
    const [hook] = Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, OrderedPlugin) ?? [];

    expect(hook).toEqual(
      expect.objectContaining({ before: ['setup-gate'], after: ['TenantProvider.load'], appliesTo: 'all-apps' }),
    );
  });
});
