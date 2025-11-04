// libs/core/src/tool/flows/tool.execute.flow.ts
import 'reflect-metadata';
import { z } from 'zod';
import { InvokePlan, FlowAsCtx, StagesFromPlan, RunPlan } from '../../invoker';

import ProviderRegistry from '../../provider/provider.registry';
import { ToolRecordImpl } from '../toolRecordImpl';
import { ToolResolveFn } from '../tool.types';
import {FlowHooksOf, ToolHookStage, Type} from '@frontmcp/sdk';

import { ControlRespond } from '../../types/invoke.type';

import { ToolInvokeContext } from '../tool.context';
import { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Scope } from '../../scope';

// ---------- Flow Input / Output ----------
const FlowInputSchema = z.object({
  tool: z.custom<ToolRecordImpl>(),
  sessionId: z.string(),
  requestId: z.union([z.string(), z.number()]),
  registry: z.custom<ProviderRegistry>(),
  resolve: z.custom<ToolResolveFn>(),
  globalHooksByStage: z.record(z.nativeEnum(ToolHookStage), z.array(z.custom<Type>())).optional(),
  user: z.object({ id: z.union([z.string(), z.number()]) }),
  rawInput: z.unknown(),
});
export type ToolExecuteFlowInput = z.infer<typeof FlowInputSchema>;
const FlowOutputSchema = z.unknown();
export type ToolExecuteFlowOutput = z.infer<typeof FlowOutputSchema>;

// ---------- Plan (non-prefixed stage names) ----------
export const toolExecutePlan = {
  name: 'tool.call' as any,
  pre: [
    'createInvokeContext',
    // rate limiting / concurrency
    'acquireQuota',
    'acquireSemaphore',
    // input shaping
    'parseInput',
    'deductInput',
    'validateInput',
    // cache entry
    'readCache',
  ],
  execute: [
    'cacheMiss',
    // execute
    'execute',
  ],
  post: [
    // output shaping
    'redactOutput',
    'validateOutputStage',
    'transformOutput',
    'writeCache',
  ],
  finalize: [
    // audit/metrics
    'audit',
    'metrics',

    // cleanup
    'releaseSemaphore',
    'releaseQuota',
    'finalize',
  ],
  error: ['error'],
} as const satisfies RunPlan<string>;
export type ToolExecuteStage = StagesFromPlan<typeof toolExecutePlan>;
const { Stage } = FlowHooksOf('tools:list-tools')as any;

// ---------- Internals ----------
type RuntimeHook = {
  providedBy: string;
  call: (ctx: ToolInvokeContext) => Promise<unknown>;
  filter?: (ctx: ToolInvokeContext) => Promise<boolean> | boolean;
  priority: number;
  sourceKind: 'class' | 'method';
  hasFilter: boolean;
};
type StageInventory = Map<ToolHookStage, RuntimeHook[]>;

function isDid(stage: ToolHookStage) {
  return String(stage).startsWith('did');
}

function orderForStage(stage: ToolHookStage, hooks: RuntimeHook[]): RuntimeHook[] {
  const asc = isDid(stage);
  return [...hooks].sort((a, b) => {
    const pa = a.priority ?? 0,
      pb = b.priority ?? 0;
    if (pa !== pb) return asc ? pa - pb : pb - pa;
    return a.providedBy.localeCompare(b.providedBy);
  });
}

// function toRuntimeHooks(stage: ToolHookStage, tool: ToolRecordImpl, classHooks: any[], fnHooks: any[]): RuntimeHook[] {
//   const fromClass: RuntimeHook[] = classHooks.map((h: any) => ({
//     providedBy: h.providedBy ?? h.constructor?.name ?? 'AnonymousHook',
//     call: async (ctx) => h[stage](ctx),
//     filter: h.filter ? (ctx) => h.filter!(ctx) : undefined,
//     priority: typeof h.priority === 'function' ? Number(h.priority()) || 0 : 0,
//     sourceKind: 'class',
//     hasFilter: typeof h.filter === 'function',
//   }));
//   const fromFn: RuntimeHook[] = fnHooks.map((fh: any) => ({
//     providedBy: fh.providedBy ?? `${tool.toolClass?.name}.${stage}`,
//     call: async (ctx) => fh[stage](ctx),
//     filter: fh.filter ? (ctx) => fh.filter!(ctx) : undefined,
//     priority: typeof fh.priority === 'function' ? Number(fh.priority()) || 0 : 0,
//     sourceKind: 'method',
//     hasFilter: typeof fh.filter === 'function',
//   }));
//   return [...fromClass, ...fromFn];
// }

async function buildContext(
  tool: ToolRecordImpl,
  sessionId: string,
  requestId: string | number,
  registry: ProviderRegistry,
  user: { id: string | number },
): Promise<ToolInvokeContext> {
  const providers = await registry.buildViews(sessionId);
  return new ToolInvokeContext({
    toolId: tool.id,
    toolName: tool.name,
    toolMetadata: tool.metadata,
    sessionId,
    requestId,
    input: undefined,
    user,
    providers,
  });
}

/** Compose aroundExecute so higher-priority hooks are outermost */
function composeAround(hooks: RuntimeHook[], exec: () => Promise<unknown>, ctx: ToolInvokeContext) {
  let next = exec;
  for (let i = hooks.length - 1; i >= 0; i--) {
    const h = hooks[i];
    const runNext = next;
    next = async () => {
      const ok = h.filter ? await h.filter(ctx) : true;
      if (!ok) return runNext();
      return (h.call as unknown as (ctx: ToolInvokeContext, next: () => Promise<unknown>) => Promise<unknown>)(
        ctx,
        runNext,
      );
    };
  }
  return next;
}

async function runWillBindProviders(hooks: RuntimeHook[], ctx: ToolInvokeContext) {
  for (const h of hooks) {
    const ok = h.filter ? await h.filter(ctx) : true;
    if (!ok) continue;
    const ret = await h.call(ctx as any);
    if (!ret) continue;
    if (ret instanceof Map) {
      for (const [k, v] of ret) ctx.bindProvider(k as any, v);
    } else if (Array.isArray(ret)) {
      ctx.bindProviders(ret as Array<[any, any]>);
    } else if (typeof ret === 'object') {
      for (const k of Object.keys(ret)) ctx.bindProvider(k as any, (ret as any)[k]);
    }
  }
}

interface ToolExecuteFlowRawInput {
  tool: ToolRecordImpl;
  payload: CallToolRequest['params'];
  authInto: AuthInfo;
}

@InvokePlan(toolExecutePlan)
export default class ToolExecuteFlow extends FlowAsCtx<
  ToolExecuteFlowRawInput,
  ToolExecuteFlowInput,
  ToolExecuteFlowOutput
> {

  constructor(options: ToolExecuteFlowRawInput) {
    super({ rawInput: options });
  }

  // ---------- runtime ----------
  private ctx!: ToolInvokeContext;
  private stageInventory: StageInventory = new Map();
  state = { cacheHit: false };

  @Stage('createInvokeContext')
  async createInvokeContext() {
    await this.createToolContext();
  }

  // ---------- defaultFlowPlan: parse/validate ----------
  @Stage('parseInput')
  async parseInput() {
    await this.runToolStage(ToolHookStage.willParseInput);
  }

  @Stage('validateInput')
  async validateInput() {
    await this.runToolStage(ToolHookStage.willValidateInput);
  }

  // ========== PIPELINE STAGES (non-prefixed) ==========
  private async createToolContext() {
    // sessionId, requestId, registry, user, resolve, globalHooksByStage
    const scope = this.get(Scope);
    // TODO : Fix resolver by executing app
    // const executor = this.rawInput.tool.getExecutor(scope.apps[0].resolve);
    // const result = await executor(this.rawInput.payload as any, this.ctx);
    // this.ctx.output = result as any;
    // ;
    // const resolve = scope.apps[0].resolve;
    // const registry = scope.apps[0].providers;

    const { tool, sessionId = 'asdsad', requestId = 'asdasd', user = {} } = this.rawInput as any;
    // this.ctx = await buildContext(tool, sessionId, requestId, registry, user);
    this.ctx.input = this.rawInput.payload.arguments as any;

    // pre-collect ordered hooks for all stages (so we reuse per stage)
    const allStages: ToolHookStage[] = [
      ToolHookStage.willCreateInvokeContext,
      ToolHookStage.didCreateInvokeContext,
      ToolHookStage.willBindProviders,
      ToolHookStage.willAcquireQuota,
      ToolHookStage.willAcquireSemaphore,
      ToolHookStage.willParseInput,
      ToolHookStage.willValidateInput,
      ToolHookStage.willNormalizeInput,
      ToolHookStage.willRedactInput,
      ToolHookStage.willInjectSecrets,
      ToolHookStage.willReadCache,
      ToolHookStage.didCacheMiss,
      ToolHookStage.didCacheHit,
      ToolHookStage.aroundExecute,
      ToolHookStage.willRedactOutput,
      ToolHookStage.willValidateOutput,
      ToolHookStage.willTransformOutput,
      ToolHookStage.willWriteCache,
      ToolHookStage.willAudit,
      ToolHookStage.didAudit,
      ToolHookStage.onMetrics,
      ToolHookStage.didReleaseSemaphore,
      ToolHookStage.didReleaseQuota,
      ToolHookStage.willFinalizeInvoke,
      ToolHookStage.onError,
    ];

    // for (const stage of allStages) {
    //   const classHooks = await collectHooksForStage(stage, tool, resolve, {});
    //   const fnHooks = await collectFnHooksForStage(stage, tool, resolve);
    //   this.stageInventory.set(stage, orderForStage(stage, toRuntimeHooks(stage, tool, classHooks, fnHooks)));
    // }
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await this.runToolStage(ToolHookStage.willAcquireQuota);
  }

  @Stage('acquireSemaphore')
  async acquireSemaphore() {
    await this.runToolStage(ToolHookStage.willAcquireSemaphore);
  }

  @Stage('parseInput')
  async _parseInputStage() {
    await this.runToolStage(ToolHookStage.willParseInput);
  }

  @Stage('validateInput')
  async _validateInputStage() {
    await this.runToolStage(ToolHookStage.willValidateInput);
  }

  @Stage('deductInput')
  async redactInput() {
    await this.runToolStage(ToolHookStage.willRedactInput);
  }

  @Stage('readCache')
  async readCache() {
    try {
      await this.runToolStage(ToolHookStage.willReadCache);
    } catch (e) {
      if (e instanceof ControlRespond) {
        this.state.cacheHit = true;
        this.ctx.output = e.value as any;
      } else {
        throw e;
      }
    }
  }

  @Stage('cacheMiss', { filter: (flow: ToolExecuteFlow) => !flow.state.cacheHit })
  async cacheMiss() {
    try {
      await this.runToolStage(ToolHookStage.didCacheMiss);
    } catch (e) {
      if (e instanceof ControlRespond) {
        this.state.cacheHit = true;
        this.ctx.output = e.value as any;
      } else {
        throw e;
      }
    }
  }

  @Stage('execute', { filter: (flow: ToolExecuteFlow) => !flow.state.cacheHit })
  async executeStage() {
    await this.runToolStage(ToolHookStage.willExecute);
    const scope = this.get(Scope);

    // TODO : Fix resolver by executing app
    // const executor = this.rawInput.tool.getExecutor(scope.apps[0].resolve);
    // const result = await executor(this.rawInput.payload as any, this.ctx);
    // this.ctx.output = result as any;
    await this.runToolStage(ToolHookStage.didExecute);
  }

  @Stage('redactOutput')
  async redactOutput() {
    await this.runToolStage(ToolHookStage.willRedactOutput);
  }

  @Stage('validateOutputStage')
  async validateOutputStage() {
    await this.runToolStage(ToolHookStage.willValidateOutput);
  }

  @Stage('transformOutput')
  async transformOutput() {
    await this.runToolStage(ToolHookStage.willTransformOutput);
  }

  @Stage('writeCache', { filter: (flow: ToolExecuteFlow) => !flow.state.cacheHit })
  async writeCache() {
    await this.runToolStage(ToolHookStage.willWriteCache);
  }

  @Stage('audit')
  async audit() {
    // combine willAudit + didAudit under a single flow stage name
    await this.runToolStage(ToolHookStage.willAudit);
    await this.runToolStage(ToolHookStage.didAudit);
  }

  @Stage('metrics')
  async metrics() {
    await this.runToolStage(ToolHookStage.onMetrics);
  }

  @Stage('releaseSemaphore')
  async releaseSemaphore() {
    await this.runToolStage(ToolHookStage.didReleaseSemaphore);
  }

  @Stage('releaseQuota')
  async releaseQuota() {
    await this.runToolStage(ToolHookStage.didReleaseQuota);
  }

  @Stage('finalize')
  async finalizeInvoke() {
    try {
      await this.runToolStage(ToolHookStage.willFinalizeInvoke);
    } finally {
      this.output = this.ctx.output as any;
    }
  }

  // ---------- helpers ----------
  private async runToolStage(stage: ToolHookStage) {
    const hooks = this.stageInventory.get(stage) ?? [];
    for (const h of hooks) {
      const ok = h.filter ? await h.filter(this.ctx) : true;
      if (!ok) continue;
      await h.call(this.ctx as any);
    }
  }
}
