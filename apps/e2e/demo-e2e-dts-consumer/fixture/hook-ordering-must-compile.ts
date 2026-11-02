import 'reflect-metadata';

import {
  addHookObserver,
  App,
  FrontMcp,
  FRONTMCP_CONTEXT,
  HOOK_TRACE_META_KEY,
  HookPhase,
  HttpHook,
  Plugin,
  ToolHook,
  type FlowCtxOf,
  type HookObserver,
  type HookTraceEntry,
} from '@frontmcp/sdk';

@Plugin({ name: 'feature-gate' })
export class FeatureGatePlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard - 10, before: ['setup-gate'], after: ['TenantPlugin.resolve'] })
  refuseDisabled(ctx: FlowCtxOf<'tools:call-tool'>): void {
    void ctx.toolName;
  }

  @ToolHook.Around('execute', { priority: HookPhase.observe, appliesTo: 'all-apps' })
  async time(_ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<void>): Promise<void> {
    await next();
  }

  @ToolHook.Did('execute', { priority: HookPhase.shape, after: ['result-handles'], appliesTo: 'uncovered-apps' })
  trim(): void {}
}

const countHooks: HookObserver = async (hook, run) => {
  void [hook.flowName, hook.stage, hook.type, hook.owner, hook.method];
  await run();
};

@Plugin({ name: 'hook-counter' })
export class HookCounterPlugin {
  @HttpHook.Will('traceRequest', { priority: HookPhase.resolve })
  watch(ctx: FlowCtxOf<'http:request'>): void {
    addHookObserver(ctx.get(FRONTMCP_CONTEXT), countHooks);
  }
}

@App({ name: 'Gated', plugins: [FeatureGatePlugin, HookCounterPlugin] })
export class GatedApp {}

@FrontMcp({ info: { name: 'gated', version: '1.0.0' }, apps: [GatedApp], devtools: { hookTrace: true } })
export class GatedServer {}

export function slowestHook(meta: Record<string, unknown> | undefined): string | undefined {
  const trace = (meta?.[HOOK_TRACE_META_KEY] ?? []) as HookTraceEntry[];
  const [slowest] = [...trace].sort((a, b) => b.ms - a.ms);
  return slowest && `${slowest.owner}.${slowest.method} (${slowest.type} ${slowest.stage}): ${slowest.outcome}`;
}
