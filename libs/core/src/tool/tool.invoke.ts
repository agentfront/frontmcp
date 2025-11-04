// libs/core/src/tool/tool.invoke.ts
import { ToolRecordImpl } from './toolRecordImpl';
import { ToolHookStage, Type } from '@frontmcp/sdk';
import {
  collectFnHooksForStage,
  collectHooksForStage,
  sortForStage,
  toolFinalizeStages,
  ToolHook,
  toolOutputStages,
  toolPreStages,
} from './tool.hook';
import ProviderRegistry from '../provider/provider.registry';
import { ToolResolveFn } from './tool.types';
import { ToolInvokeContext } from './tool.context';
import { ControlAbort, ControlRespond, ControlRetryAfter } from '../types/invoke.type';
import { ProviderViews } from '../provider/provider.types';

export interface ToolInvokeOptions {
  tool: ToolRecordImpl;
  rawInput: unknown;
  sessionId: string;
  requestId: string | number;
  registry: ProviderRegistry;
  resolve: ToolResolveFn;
  globalHooksByStage?: Partial<Record<ToolHookStage, Type[]>>;
  user: ContextUser;
}

interface RunStageOptions {
  tool: ToolRecordImpl;
  ctx: ToolInvokeContext;
  resolve: ToolResolveFn;
  globalHooksByStage?: Partial<Record<ToolHookStage, Type[]>>;
}

async function runStage(
  stage: ToolHookStage,
  options: { tool: ToolRecordImpl; ctx: any; resolve: any; globalHooksByStage?: any; collectOnly?: boolean },
): Promise<ToolHook[] | void> {
  const { tool, ctx, resolve, globalHooksByStage } = options;
  const classHooks = await collectHooksForStage(stage, tool as any, resolve, globalHooksByStage);
  const fnHooks = await collectFnHooksForStage(stage, tool as any, resolve);
  const hooks = [...classHooks, ...fnHooks];

  if (!hooks.length) {
    return options.collectOnly ? [] : undefined;
  }

  const active: ToolHook[] = [];
  for (const h of hooks) {
    const ok = h.filter ? await h.filter(ctx) : true;
    if (ok) active.push(h);
  }

  const ordered = sortForStage(stage, active);
  if (options.collectOnly) return ordered;

  for (const h of ordered) {
    console.log(`---> running stage: ${h.providedBy}`);
    await (h as any)[stage](ctx);
  }
}

async function runPostStages(ctx: ToolInvokeContext, stageOptions: RunStageOptions): Promise<ToolHook[] | void> {
  for (const stag of toolOutputStages) {
    await runStage(stag as ToolHookStage, stageOptions);
  }
  if (!ctx.data.get('__cache_hit__')) {
    await runStage(ToolHookStage.willWriteCache, stageOptions);
  }
  for (const stag of toolFinalizeStages) {
    await runStage(stag as ToolHookStage, stageOptions);
  }
}

/**
 * Compose aroundExecute hooks (global + tool) into one wrapper.
 */
export async function wrapWithAround<T>(
  tool: ToolRecordImpl,
  ctx: ToolInvokeContext,
  exec: () => Promise<T>,
  resolve: ToolResolveFn,
  globalHooksByStage?: Partial<Record<ToolHookStage, Type[]>>,
): Promise<T> {
  // Collect class-based around hooks directly from tool/global config
  const typeList: any[] = [
    ...(globalHooksByStage?.[ToolHookStage.aroundExecute] ?? []),
    ...(tool.hooksByStage?.[ToolHookStage.aroundExecute] ?? []),
  ];
  const classHooks: ToolHook[] = typeList
    .map((t) => resolve<ToolHook>(t))
    .filter((h) => h && typeof (h as any).aroundExecute === 'function');

  // Collect function-based (decorator) hooks
  const fnHooks = await collectFnHooksForStage(
    ToolHookStage.aroundExecute,
    tool as any,
    resolve,
  );

  const hooks: ToolHook[] = [...classHooks, ...fnHooks];

  if (!hooks.length) {
    console.log(`---> running stage: ${ToolHookStage.willExecute}`);
    const res = await exec();
    console.log(`---> running stage: ${ToolHookStage.didExecute}`);
    return res;
  }

  // Sort by priority using common sorter (higher first for around/will*)
  const ordered = sortForStage(ToolHookStage.aroundExecute, hooks);

  console.log(`---> running stage: ${ToolHookStage.aroundExecute}`);
  // Compose wrappers so higher-priority hooks are outermost: build chain from inner to outer
  let next: () => Promise<unknown> = exec as any;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const h = ordered[i] as any;
    const runNext = next;
    const willRun = h.filter ? await h.filter(ctx) : true;
    if (!willRun) continue;
    next = () => h.aroundExecute(ctx, runNext);
  }
  console.log(`---> running stage: ${ToolHookStage.willExecute}`);
  const result = await next();
  console.log(`---> running stage: ${ToolHookStage.didExecute}`);
  return result as T;
}

/** Bind providers via hooks (plugins can add request/session providers). */
export async function willBindProvidersStage(
  tool: ToolRecordImpl,
  ctx: ToolInvokeContext,
  resolve: ToolResolveFn,
  globalHooksByStage?: Partial<Record<ToolHookStage, Type[]>>,
) {
  const hookTypes: Type[] = [
    ...(globalHooksByStage?.[ToolHookStage.willBindProviders] ?? []),
    ...(tool.hooksByStage?.[ToolHookStage.willBindProviders] ?? []),
  ];
  if (!hookTypes.length) return;

  const hooks = hookTypes
    .map((t) => resolve<ToolHook>(t as any))
    .filter((h) => h && typeof (h as any).willBindProviders === 'function');

  for (const h of hooks) {
    if (!(await (h.filter?.(ctx as any) ?? true))) continue;
    // Hooks typically call ctx.bindProvider()/bindProviders() themselves.
    // But we also accept a return value for convenience.
    const ret = await (h as any).willBindProviders(ctx);
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

export async function invokeTool<TOut = unknown>(options: ToolInvokeOptions): Promise<TOut> {

  console.log('\n\n----------------------------------------------------\n| Invoking tool:', options.tool.name, '\n----------------------------------------------------');
  const { tool, rawInput, sessionId, requestId, registry, resolve, globalHooksByStage, user } = options;

  // Build provider views and pass to context (no copying needed later)
  const providers: ProviderViews = await registry.buildViews(sessionId);

  const ctx = new ToolInvokeContext({
    toolId: tool.id,
    toolName: tool.name,
    toolMetadata: tool.metadata,
    sessionId,
    requestId,
    input: rawInput,
    user,
    providers,
  });

  // Guard: canActivate (if provided) must allow invocation
  const canActivate = tool.getCanActivate(resolve);
  if (canActivate) {
    const allowed = await canActivate(ctx as any);
    if (!allowed) throw new ControlAbort('TOOL_NOT_ACTIVATED', 'TOOL_NOT_ACTIVATED', 403);
  }

  const stageOptions = {
    tool,
    ctx,
    resolve,
    globalHooksByStage,
  };
  // Helper to ensure finalization/audit always run
  const finalize = async () => {
    try {
      await runStage(ToolHookStage.willFinalizeInvoke, stageOptions);
    } catch {
      /* swallow finalize errors */
    }
  };

  try {
    // Provider binding via hooks
    await willBindProvidersStage(tool, ctx, resolve, globalHooksByStage);

    // run pre execute stages
    for (const stag of toolPreStages) {
      await runStage(stag as ToolHookStage, stageOptions);
    }

    // run cache stages
    try {
      await runStage(ToolHookStage.willReadCache, stageOptions);
      await runStage(ToolHookStage.didCacheMiss, stageOptions);
    } catch (e) {
      if (e instanceof ControlRespond) {
        ctx.data.set('__cache_hit__', true);
        await runStage(ToolHookStage.didCacheHit, stageOptions);

        for (const stag of toolFinalizeStages) {
          await runStage(stag as ToolHookStage, stageOptions);
        }
        await finalize();
        return ctx.output as TOut;
      }
      // noinspection ExceptionCaughtLocallyJS
      throw e; // rethrow to run post-stages
    }

    // Execute (with around wrappers)
    const exec = async () => {
      await runStage(ToolHookStage.willExecute, stageOptions);
      const execute = tool.getExecutor(resolve);
      const out = await execute(ctx.input, ctx);
      ctx.output = out;
      await runStage(ToolHookStage.didExecute, stageOptions);
      return out as TOut;
    };

    const result = await wrapWithAround<TOut>(tool, ctx, exec, resolve, globalHooksByStage);
    ctx.output = result;

    await runPostStages(ctx, stageOptions);
    await finalize();
    return ctx.output as TOut;
  } catch (err) {
    // Handle control flow
    if (err instanceof ControlRespond) {
      ctx.output = err.value;

      try {
        await runPostStages(ctx, stageOptions);
        return ctx.output as TOut;
      } finally {
        await finalize();
      }
    }
    if (err instanceof ControlRetryAfter || err instanceof ControlAbort) {
      try {
        await runStage(ToolHookStage.onError, stageOptions);
      } finally {
        await finalize();
      }
      throw err;
    }

    // Unknown error → run onError and rethrow
    try {
      ctx.output = undefined;
      ctx.error = err;
      await runStage(ToolHookStage.onError, stageOptions);
    } finally {
      await finalize();
    }
    throw err;
  }
}
