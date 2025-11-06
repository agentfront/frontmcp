// noinspection ExceptionCaughtLocallyJS

import 'reflect-metadata';
import {
  FlowControl,
  FlowEntry, FlowInputOf,
  FlowName, FlowOutputOf, FlowPlan,
  FlowRecord,
  FlowType,
  Reference,
  ServerRequest,
  Token, Type,
} from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';
import {collectFlowHookMap, StageMap} from './flow.stages';
import {writeHttpResponse} from '../server/server.validation';
import {Scope} from '../scope';

type StageOutcome =
  | 'ok'
  | 'respond'
  | 'next'
  | 'handled'
  | 'fail'
  | 'abort'
  | 'unknown_error';

interface StageResult {
  outcome: StageOutcome;
  control?: FlowControl | Error;
}

export class FlowInstance<Name extends FlowName> extends FlowEntry<Name> {
  readonly deps: Reference[];
  readonly globalProviders: ProviderRegistry;
  private plan: FlowPlan<never>;
  private FlowClass: FlowType;
  private stages: StageMap<FlowType>;
  private globalDeps: Map<Token, Type>;

  constructor(scope: Scope, record: FlowRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(scope, record);
    this.deps = [...deps];
    this.globalProviders = globalProviders;
    this.FlowClass = this.record.provide;
    this.ready = this.initialize();
    this.plan = this.record.metadata.plan;
  }

  protected async initialize() {
    const server = this.globalProviders.getActiveServer();

    this.stages = collectFlowHookMap(this.FlowClass);
    this.globalDeps = new Map();

    const {middleware} = this.metadata;
    if (middleware) {
      const path = typeof middleware.path === 'string' ? middleware.path : '';
      server.registerMiddleware(path, async (request, response, next) => {
        const canActivate = await this.canActivate(request);
        if (!canActivate) return next();

        try {
          const result = await this.run({request, response, next} as any, new Map());
          if (result) return writeHttpResponse(response, result);
        } catch (e) {
          if (e instanceof FlowControl) {
            switch (e.type) {
              case 'abort':
                return writeHttpResponse(response, {kind: 'text', status: 500, body: 'Aborted'});
              case 'fail':
                // e.output is the Error; do not leak details
                return writeHttpResponse(response, {kind: 'text', status: 500, body: 'Internal Server Error'});
              case 'handled':
                return; // response already produced by user code
              case 'next':
                // continue middleware chain
                return next();
              case 'respond':
                // Shouldn't reach here; run() always consumes respond
                return writeHttpResponse(response, e.output as any);
            }
          }
          // Unknown error fallback
          // eslint-disable-next-line no-console
          console.error(e);
          return writeHttpResponse(response, {kind: 'text', status: 500, body: 'Internal Server Error'});
        }

        // Flow didn't control the response → continue
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

    const results = await Promise.all(canActivate.map(m => m(request, this.scope)));
    return results.every(r => r);
  }

  async run(input: FlowInputOf<Name>, deps: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined> {
    const scope = this.globalProviders.getActiveScope();
    const {stages, FlowClass, plan} = this;

    // Construct user flow instance with deps map
    const context = new (FlowClass as any)(this.metadata, input, scope, deps) as any;

    let responded: FlowOutputOf<Name> | undefined;

    const didKey = (stage: string) => `did${stage.charAt(0).toUpperCase()}${stage.slice(1)}`;

    // Run one stage list and apply "did{Stage}" rule:
    // - run did* if stage finished OK or threw FlowControl.respond
    // - do NOT run did* for fail/abort/next/handled/unknown errors
    const runHookList = async (
      key: string,
      opts?: { ignoreRespond?: boolean }
    ): Promise<StageResult> => {
      const list = (stages as any)[key] ?? [];
      const didList = (stages as any)[didKey(key)] ?? [];

      for (const item of list) {
        try {
          await item.method(context);
          // finished → run did{Stage}
          for (const d of didList) await d.method(context);
        } catch (e: any) {
          if (e instanceof FlowControl) {
            if (e.type === 'respond') {
              if (!opts?.ignoreRespond) {
                // run did{Stage} on respond
                for (const d of didList) await d.method(context);
                responded = e.output as FlowOutputOf<Name>;
                return {outcome: 'respond', control: e};
              }
              // explicitly ignore respond in this stage (used by error stage)
              for (const d of didList) await d.method(context);
              continue;
            }
            return {outcome: e.type, control: e};
          }
          return {outcome: 'unknown_error', control: e as Error};
        }
      }
      return {outcome: 'ok'};
    };

    const runStageGroup = async (
      group: Array<string> | undefined,
      stopOnRespond: boolean,
      opts?: { ignoreRespond?: boolean }
    ): Promise<StageResult> => {
      if (!group || group.length === 0) return {outcome: 'ok'};

      let sawRespond = false;
      let last: StageResult = {outcome: 'ok'};

      for (const key of group) {
        const res = await runHookList(key, opts);
        last = res;

        if (res.outcome === 'respond') {
          sawRespond = true;
          if (stopOnRespond) return res;
          // continue running remaining stages in this group
          continue;
        }
        if (res.outcome !== 'ok') {
          return res; // next/handled/fail/abort/unknown_error
        }
      }

      return sawRespond ? {outcome: 'respond', control: last.control} : last;
    };

    const runErrorStage = async () => {
      // Only called for unknown exceptions or fail; spec says: run error stage then rethrow.
      // We **ignore** responds inside error stage (they do not change control flow).
      await runStageGroup((plan as any).error, /*stopOnRespond*/ false, {ignoreRespond: true});
    };

    const runFinalizeStage = async () => {
      await runStageGroup((plan as any).finalize, /*stopOnRespond*/ false);
    };

    // Pipeline controller with guaranteed finalize
    try {
      // ---------- PRE ----------
      {
        const pre = await runStageGroup(plan.pre as any, /*stopOnRespond*/ true);
        if (pre.outcome === 'respond') {
          // skip execute, still run post + finalize
          const post = await runStageGroup(plan.post as any, /*stopOnRespond*/ false);
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
            throw post.control as FlowControl; // propagate control
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
        const exec = await runStageGroup(plan.execute as any, /*stopOnRespond*/ true);
        if (exec.outcome === 'respond') {
          // didExecute already ran; proceed with post + finalize
          // fall-through to post below
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

      // ---------- POST (always, even after respond) ----------
      {
        const post = await runStageGroup(plan.post as any, /*stopOnRespond*/ false);
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

      // ---------- FINALIZE (always) ----------
      await runFinalizeStage();

      return responded;
    } catch (e) {
      // finalize already run above in all error paths
      throw e;
    }
  }
}
