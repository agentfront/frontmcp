import { ToolInvokeContext } from './tool.context';
import { ToolRecordImpl } from './toolRecordImpl';
import { ToolResolveFn } from './tool.types';
import { ToolHookStage, Type } from '@frontmcp/sdk';


export interface ToolHook {
  priority?(): number;
  filter?(ctx: ToolInvokeContext): boolean | Promise<boolean>;
  providedBy: string;
  aroundExecute?: (
    ctx: ToolInvokeContext,
    next: () => Promise<unknown>
  ) => Promise<unknown>;
  // any of the stages listed in HookStage may be implemented:
  [stage: string]: any;
}

export const toolPreStages = [
  ToolHookStage.willCreateInvokeContext,
  ToolHookStage.didCreateInvokeContext,
  // Policy gates
  ToolHookStage.willAuthorize,
  ToolHookStage.willCheckConsent,
  ToolHookStage.willCheckFeatureFlags,
  // Capacity / resilience
  ToolHookStage.willAcquireQuota,
  ToolHookStage.willAcquireSemaphore,
  // Input shaping
  ToolHookStage.willParseInput,
  ToolHookStage.willValidateInput,
  ToolHookStage.willNormalizeInput,
  ToolHookStage.willRedactInput,
  ToolHookStage.willInjectSecrets,

];



export const toolOutputStages = [
  // Output shaping
  ToolHookStage.willRedactOutput,
  ToolHookStage.willValidateOutput,
  ToolHookStage.willTransformOutput,
];
export const toolFinalizeStages = [
  // Audit/metrics
  ToolHookStage.willAudit,
  ToolHookStage.didAudit,
  ToolHookStage.onMetrics,

  ToolHookStage.didReleaseSemaphore,
  ToolHookStage.didReleaseQuota,
];

export const toolErrorStages = [
  // Cache writes
  ToolHookStage.onError,

  // Audit/metrics
  ToolHookStage.willAudit,
  ToolHookStage.didAudit,
  ToolHookStage.onMetrics,

  // Capacity / resilience
  ToolHookStage.didReleaseSemaphore,
  ToolHookStage.didReleaseQuota,
];

export function sortForStage(
  stage: ToolHookStage,
  hooks: ToolHook[]
): ToolHook[] {
  if (stage.startsWith('did'))
    return hooks.sort((a, b) => (a.priority?.() ?? 0) - (b.priority?.() ?? 0));
  // for will*/around*/others: higher first
  return hooks.sort((a, b) => (b.priority?.() ?? 0) - (a.priority?.() ?? 0));
}

export async function collectHooksForStage(
  stage: ToolHookStage,
  tool: ToolRecordImpl,
  resolve: ToolResolveFn,
  globalHooksByStage?: Partial<Record<ToolHookStage, Type[]>>
): Promise<ToolHook[]> {
  const types: Type[] = [
    ...(globalHooksByStage?.[stage] ?? []),
    ...(tool.hooksByStage?.[stage] ?? []),
  ];
  if (types.length === 0) return [];
  const instances = types
    .map((t: Type<any>) => resolve<ToolHook>(t))
    .filter(Boolean);
  // only keep those implementing the method
  const withMethod = instances.filter(
    (h: any) => typeof h?.[stage] === 'function'
  );
  return withMethod as ToolHook[];
}


// Adds function-based handlers (decorators) to the list
export async function collectFnHooksForStage(
  stage: ToolHookStage,
  tool: ToolRecordImpl,
  resolve: <T>(cls: any) => T
) {
  const metas = tool.hookFnsByStage?.[stage] ?? [];
  // Wrap each method meta as a ToolHook-like object so existing sort/filter apply
  const handlers: ToolHook[] = [];
  for (const m of metas) {
    const priority = () => m.priority ?? 0;
    const filter = async (ctx: any) => {
      if (!m.filterKey) return true;
      const C: any = tool.toolClass;
      if (m.isStatic) {
        const f = C[m.filterKey];
        return typeof f === 'function' ? !!(await f.call(C, ctx)) : true;
      } else {
        const inst: any = resolve(tool.toolClass);
        const f = inst?.[m.filterKey];
        return typeof f === 'function' ? !!(await f.call(inst, ctx)) : true;
      }
    };

    if (stage === ToolHookStage.aroundExecute) {
      const aroundExecute = async (ctx: any, next: () => Promise<unknown>) => {
        if (m.isStatic) {
          const fn = (tool.toolClass as any)[m.methodName];
          return fn.call(tool.toolClass, ctx, next);
        }
        const inst: any = resolve(tool.toolClass);
        const fn = inst?.[m.methodName];
        return fn.call(inst, ctx, next);
      };
      handlers.push({ priority, filter, aroundExecute, providedBy: `${tool.toolClass.name}.${m.methodName}` });
    } else {
      const callable = async (ctx: any) => {
        if (m.isStatic) {
          const fn = (tool.toolClass as any)[m.methodName];
          return fn.call(tool.toolClass, ctx);
        }
        const inst: any = resolve(tool.toolClass);
        const fn = inst?.[m.methodName];
        return fn.call(inst, ctx);
      };
      handlers.push({ priority, filter, [stage]: callable, providedBy: `${tool.toolClass.name}.${m.methodName}`  });
    }
  }
  return handlers;
}
