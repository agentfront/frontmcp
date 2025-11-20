// noinspection ExceptionCaughtLocallyJS
// flows/flow.instance.ts

import 'reflect-metadata';
import {
  FlowControl,
  FlowCtxOf,
  FlowEntry,
  FlowInputOf,
  FlowName,
  FlowOutputOf,
  FlowPlan,
  FlowRecord,
  FlowStagesOf,
  FlowType,
  HookEntry,
  HookMetadata,
  Reference,
  ServerRequest,
  Token,
  Type,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import { collectFlowHookMap, StageMap, cloneStageMap, mergeHookMetasIntoStageMap } from './flow.stages';
import { writeHttpResponse } from '../server/server.validation';
import { Scope } from '../scope';
import HookRegistry from '../hooks/hook.registry';
import { rpcError } from '../transport/transport.error';

type StageOutcome = 'ok' | 'respond' | 'next' | 'handled' | 'fail' | 'abort' | 'unknown_error';

interface StageResult {
  outcome: StageOutcome;
  control?: FlowControl | Error;
}

const CAP = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const WILL = (s: string) => `will${CAP(s)}`;
const DID = (s: string) => `did${CAP(s)}`;
const AROUND = (s: string) => `around${CAP(s)}`;

function parseTypedKey(k: string): { base: string; type?: 'will' | 'did' | 'around' } {
  const lc = k.toLowerCase();
  if (lc.startsWith('will') && k.length > 4) return { base: k.slice(4, 5).toLowerCase() + k.slice(5), type: 'will' };
  if (lc.startsWith('did') && k.length > 3) return { base: k.slice(3, 4).toLowerCase() + k.slice(4), type: 'did' };
  if (lc.startsWith('around') && k.length > 6)
    return { base: k.slice(6, 7).toLowerCase() + k.slice(7), type: 'around' };
  return { base: k };
}

export class FlowInstance<Name extends FlowName> extends FlowEntry<Name> {
  readonly deps: Reference[];
  readonly globalProviders: ProviderRegistry;
  private plan: FlowPlan<never>;
  private FlowClass: FlowType;
  private stages: StageMap<FlowType>;
  private hooks: HookRegistry;

  constructor(scope: Scope, record: FlowRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(scope, record);
    this.deps = [...deps];
    this.globalProviders = globalProviders;
    this.FlowClass = this.record.provide;
    this.ready = this.initialize();
    this.plan = this.record.metadata.plan;
    this.hooks = scope.providers.getHooksRegistry();
  }

  protected async initialize() {
    const server = this.globalProviders.getActiveServer();

    this.stages = collectFlowHookMap(this.FlowClass);

    const { middleware } = this.metadata;
    if (middleware) {
      const path = typeof middleware.path === 'string' ? middleware.path : '';
      server.registerMiddleware(path, async (request, response, next) => {
        const canActivate = await this.canActivate(request);
        if (!canActivate) return next();

        try {
          const result = await this.run({ request, response, next } as any, new Map());
          if (result) return writeHttpResponse(response, result);
        } catch (e) {
          if (e instanceof FlowControl) {
            switch (e.type) {
              case 'abort':
                return writeHttpResponse(response, { kind: 'text', status: 500, body: 'Aborted' });
              case 'fail':
                return writeHttpResponse(response, { kind: 'text', status: 500, body: 'Internal Server Error' });
              case 'handled':
                return;
              case 'next':
                return next();
              case 'respond':
                return writeHttpResponse(response, e.output as any);
            }
          }
          // eslint-disable-next-line no-console
          console.error(e);
          return writeHttpResponse(response, {
            kind: 'text',
            status: 500,
            body: 'Internal Server Error',
          });
        }

        return next();
      });
    }

    return Promise.resolve();
  }

  async canActivate(request: ServerRequest): Promise<boolean> {
    if (this.method && request.method !== this.method) return false;

    const canActivate = this.metadata.middleware?.canActivate ?? [];
    if ((this.FlowClass as any)['canActivate']) {
      canActivate.push((this.FlowClass as any)['canActivate']);
    }
    if (canActivate.length === 0) return true;

    const results = await Promise.all(canActivate.map((m) => m(request, this.scope)));
    return results.every((r) => r);
  }

  async run(input: FlowInputOf<Name>, deps: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined> {
    const scope = this.globalProviders.getActiveScope();
    const { FlowClass, plan, name } = this;

    // Clone stages so we can merge injections safely per run.
    const baseStages = this.stages;
    let stages: StageMap<any> = cloneStageMap(baseStages);

    // Compute next order base after any class-defined entries.
    let orderBase = Math.max(0, ...Object.values(stages).flatMap((list) => list.map((e: any) => e._order ?? 0))) + 1;

    // Get tool owner ID if this is a tool call flow
    // The tool owner ID is set by the CallToolFlow.findTool stage
    const toolOwnerId = (input as any)?._toolOwnerId;

    const initialInjectedHooks =
      (this.hooks.getFlowHooksForOwner(name, toolOwnerId) as HookEntry<
        FlowInputOf<Name>,
        Name,
        FlowStagesOf<Name>,
        FlowCtxOf<Name>
      >[]) ?? [];

    let context: any;
    let contextReady = false;

    const materializeAndMerge = async (
      newHooks: HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[],
      opts?: { orderStart?: number },
    ) => {
      if (!newHooks?.length || !contextReady) return;

      const metas: HookMetadata[] = [];
      for (const h of newHooks) {
        try {
          metas.push(h.metadata);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[flow] Ignoring injected hook that failed to materialize:', e);
        }
      }

      if (metas.length) {
        const start = opts?.orderStart ?? orderBase;
        mergeHookMetasIntoStageMap(FlowClass, stages, metas, start);
        if (opts?.orderStart === undefined) orderBase += metas.length;
      }
    };

    const appendContextHooks = async (
      hooks: HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[],
    ) => {
      await materializeAndMerge(hooks);
    };

    // Construct flow instance
    context = new FlowClass(this.metadata, input, scope, appendContextHooks, deps);

    // Now injections can materialize
    contextReady = true;

    // Initial registry hooks should not pre-empt stages; they just get registered
    await materializeAndMerge(initialInjectedHooks, { orderStart: -1_000_000 });

    // Refresh order base to be after everything currently present
    orderBase = Math.max(0, ...Object.values(stages).flatMap((list) => list.map((e: any) => e._order ?? 0))) + 1;

    let responded: FlowOutputOf<Name> | undefined;

    // Robust list runner (doesn't skip mid-run insertions)
    const runList = async (key: string, opts?: { ignoreRespond?: boolean }): Promise<StageResult> => {
      const getList = () => ((stages as any)[key] ?? []) as Array<{ method: (ctx: any) => Promise<void> }>;
      const seen = new Set<any>();

      while (true) {
        const list = getList();
        const item = list.find((e) => !seen.has(e));
        if (!item) break;
        seen.add(item);

        try {
          await item.method(context);
        } catch (e: any) {
          if (e instanceof FlowControl) {
            if (e.type === 'respond') {
              if (!opts?.ignoreRespond) {
                responded = e.output as FlowOutputOf<Name>;
                return { outcome: 'respond', control: e };
              }
              continue;
            }
            return { outcome: e.type, control: e };
          }
          return { outcome: 'unknown_error', control: e as Error };
        }
      }
      return { outcome: 'ok' };
    };

    // Run exactly one stage in order: will → around → stage → did (did runs once)
    const runOneStage = async (stageName: string, stopOnRespond: boolean): Promise<StageResult> => {
      // 1) willStage
      {
        const res = await runList(WILL(stageName));
        if (res.outcome === 'respond' && stopOnRespond) return res;
        if (res.outcome !== 'ok' && res.outcome !== 'respond') return res;
      }

      // 2) aroundStage (acts as pre-handlers unless you later add true wrapping)
      {
        const res = await runList(AROUND(stageName));
        if (res.outcome === 'respond' && stopOnRespond) return res;
        if (res.outcome !== 'ok' && res.outcome !== 'respond') return res;
      }

      // 3) stage
      let bodyOutcome: StageResult = { outcome: 'ok' };
      {
        const res = await runList(stageName, { ignoreRespond: false });
        bodyOutcome = res;
        if (res.outcome !== 'ok' && res.outcome !== 'respond') {
          // fail/abort/next/handled/unknown → do NOT run did
          // return res;/
          throw res.control;
        }
      }

      // 4) didStage (run once regardless of body respond)
      {
        const res = await runList(DID(stageName), { ignoreRespond: true });
        if (res.outcome !== 'ok' && res.outcome !== 'respond') return res;
      }

      if (bodyOutcome.outcome === 'respond') return bodyOutcome;
      return { outcome: 'ok' };
    };

    // IMPORTANT: ignore typed stage names in plan arrays.
    // Only base stage names in the plan drive execution; typed hooks run *with* their base.
    const runStageGroup = async (
      group: Array<string> | undefined,
      stopOnRespond: boolean,
      opts?: { ignoreRespond?: boolean },
    ): Promise<StageResult> => {
      if (!group || group.length === 0) return { outcome: 'ok' };

      const seenBase = new Set<string>();
      for (const rawKey of group) {
        const { base, type } = parseTypedKey(rawKey);
        if (type) {
          // Soft warning once per typed key occurrence (optional)
          // console.warn(`[flow] Ignoring typed stage "${rawKey}" in plan; hooks will run with base "${base}".`);
          continue; // Do not run typed keys as standalone stages
        }
        if (seenBase.has(base)) continue;
        seenBase.add(base);

        const res = await runOneStage(base, stopOnRespond);
        if (res.outcome === 'respond') {
          if (stopOnRespond) return res;
          // else keep going
        } else if (res.outcome !== 'ok') {
          return res.control?.['output'] ?? res.outcome;
        }
      }
      return { outcome: 'ok' };
    };

    const runErrorStage = async () => {
      await runStageGroup((plan as any).error, false, { ignoreRespond: true });
    };

    const runFinalizeStage = async () => {
      await runStageGroup((plan as any).finalize, false);
    };

    try {
      // ---------- PRE ----------
      {
        const pre = await runStageGroup((plan as any).pre, true);
        if (pre.outcome === 'respond') {
          const post = await runStageGroup((plan as any).post, false);
          if (post.outcome === 'unknown_error' || post.outcome === 'fail') {
            try {
              await runErrorStage();
            } finally {
              await runFinalizeStage();
            }
            if (post.outcome === 'fail') throw post.control!;
            throw post.control!;
          }
          if (post.outcome === 'abort' || post.outcome === 'next' || post.outcome === 'handled') {
            await runFinalizeStage();
            throw post.control as FlowControl;
          }
          await runFinalizeStage();
          return responded;
        }
        if (pre.outcome === 'unknown_error' || pre.outcome === 'fail') {
          try {
            await runErrorStage();
          } finally {
            await runFinalizeStage();
          }
          if (pre.outcome === 'fail') throw pre.control!;
          throw pre.control!;
        }
        if (pre.outcome === 'abort' || pre.outcome === 'next' || pre.outcome === 'handled') {
          await runFinalizeStage();
          throw pre.control as FlowControl;
        }
      }

      // ---------- EXECUTE ----------
      if (!responded) {
        const exec = await runStageGroup((plan as any).execute, true);
        if (exec.outcome === 'respond') {
          // continue to post + finalize
        } else if (exec.outcome === 'unknown_error' || exec.outcome === 'fail') {
          try {
            await runErrorStage();
          } finally {
            await runFinalizeStage();
          }
          if (exec.outcome === 'fail') throw exec.control!;
          throw exec.control!;
        } else if (exec.outcome === 'abort' || exec.outcome === 'next' || exec.outcome === 'handled') {
          await runFinalizeStage();
          throw exec.control as FlowControl;
        }
      }

      // ---------- POST ----------
      {
        const post = await runStageGroup((plan as any).post, false);
        if (post.outcome === 'unknown_error' || post.outcome === 'fail') {
          try {
            await runErrorStage();
          } finally {
            await runFinalizeStage();
          }
          if (post.outcome === 'fail') throw post.control!;
          throw post.control!;
        }
        if (post.outcome === 'abort' || post.outcome === 'next' || post.outcome === 'handled') {
          await runFinalizeStage();
          throw post.control as FlowControl;
        }
      }

      // ---------- FINALIZE ----------
      await runFinalizeStage();

      return responded;
    } catch (e) {
      throw e;
    }
  }
}
