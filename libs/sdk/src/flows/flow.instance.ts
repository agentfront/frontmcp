import 'reflect-metadata';

import { tokenName } from '@frontmcp/di';
import { isDebug, isDevelopment } from '@frontmcp/utils';

import {
  FlowControl,
  FlowEntry,
  withHttpHeaders,
  type FlowBase,
  type FlowCtxOf,
  type FlowInputOf,
  type FlowName,
  type FlowOutputOf,
  type FlowPhase,
  type FlowPlan,
  type FlowRecord,
  type FlowStagesOf,
  type FlowType,
  type FrontMcpLogger,
  type HookEntry,
  type HookMetadata,
  type HttpOutput,
  type Reference,
  type ScopeEntry,
  type ServerRequest,
  type Token,
  type Type,
} from '../common';
import { FRONTMCP_CONTEXT, FrontMcpContextStorage, type FrontMcpContext } from '../context';
import { runAsFlow } from '../context/running-flow';
import { InternalMcpError, PublicMcpError, RequestContextNotAvailableError } from '../errors';
import { findMisconfiguration, misconfigurationBody } from '../errors/misconfiguration';
import { entryContextStageOf } from '../hooks/entry-class-hooks';
import type HookRegistry from '../hooks/hook.registry';
import { bindContextHookTargets, staticHooksFor } from '../hooks/hooks.utils';
import type ProviderRegistry from '../provider/provider.registry';
import { writeHttpResponse } from '../server/server.validation';
import { flowErrorToHttpOutput } from '../transport/flow-error-output';
import { deferredFlowLoader } from './deferred-flow';
import { matchMountedPath } from './flow.http-path';
import {
  cloneStageMap,
  collectFlowHookMap,
  describeHookOrder,
  mergeHookMetasIntoStageMap,
  type HookRunner,
  type StageEntry,
  type StageMap,
} from './flow.stages';
import { collectFlowMetadata } from './flow.utils';

/**
 * Where a request's hook observer lives on its `FrontMcpContext`: `@frontmcp/observability` installs one to
 * record the hooks a request ran (`requestLogs`' `hooks_triggered`) and give each a span (`tracing.hookSpans`).
 */
const HOOK_OBSERVER_KEY = Symbol.for('frontmcp:hook-observer');

/** Wraps each injected hook a request runs: `run` runs the hook. */
type HookObserver = (
  hook: { flowName: string; stage: string; target: unknown; flowContext: unknown },
  run: () => Promise<void>,
) => Promise<void>;

type StageOutcome = 'ok' | 'respond' | 'next' | 'handled' | 'fail' | 'abort' | 'unknown_error';

const FAILED_OUTCOMES: ReadonlySet<StageOutcome> = new Set(['fail', 'abort', 'unknown_error']);

interface StageResult {
  outcome: StageOutcome;
  control?: FlowControl | Error;
}

const CAP = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

interface StageKeys {
  will: string;
  did: string;
  around: string;
  finally: string;
}

// Stage names come from flow plans, so this stays as small as the set of stages.
const stageKeysByName = new Map<string, StageKeys>();

function stageKeysOf(stage: string): StageKeys {
  let keys = stageKeysByName.get(stage);
  if (!keys) {
    keys = {
      will: `will${CAP(stage)}`,
      did: `did${CAP(stage)}`,
      around: `around${CAP(stage)}`,
      finally: `finally${CAP(stage)}`,
    };
    stageKeysByName.set(stage, keys);
  }
  return keys;
}

export function parseTypedKey(k: string): { base: string; type?: 'will' | 'did' | 'around' | 'finally' } {
  const lc = k.toLowerCase();
  if (lc.startsWith('will') && k.length > 4) return { base: k.slice(4, 5).toLowerCase() + k.slice(5), type: 'will' };
  if (lc.startsWith('did') && k.length > 3) return { base: k.slice(3, 4).toLowerCase() + k.slice(4), type: 'did' };
  if (lc.startsWith('around') && k.length > 6)
    return { base: k.slice(6, 7).toLowerCase() + k.slice(7), type: 'around' };
  if (lc.startsWith('finally') && k.length > 7)
    return { base: k.slice(7, 8).toLowerCase() + k.slice(8), type: 'finally' };
  return { base: k };
}

/** `String(value)`, or its `Object.prototype.toString` tag for a value that cannot be converted (a null-prototype object). */
function describeValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** The error a fail() carried, or an Error naming why the flow was aborted. */
function failureOf(control: FlowControl): unknown {
  const originalError = (control as { originalError?: unknown }).originalError;
  if (originalError !== undefined) return originalError;
  return control.type === 'abort' ? new InternalMcpError(`Flow aborted: ${String(control.output)}`) : control;
}

const stageBasesByGroup = new WeakMap<readonly string[], string[]>();

/** The base stages a plan group runs, in order: a typed key runs with its base, and a repeated base runs once. */
export function stageBasesOf(group: readonly string[]): string[] {
  let bases = stageBasesByGroup.get(group);
  if (!bases) {
    const seen = new Set<string>();
    bases = [];
    for (const rawKey of group) {
      const { base, type } = parseTypedKey(rawKey);
      // A stage named `finallyCheck` predates Finally hooks: it is `check`'s hook key only when the group lists `check`
      const stage = type === 'finally' && !group.includes(base) ? rawKey : base;
      if ((type && stage === base) || seen.has(stage)) continue;
      seen.add(stage);
      bases.push(stage);
    }
    stageBasesByGroup.set(group, bases);
  }
  return bases;
}

// The order a failed run reaches them in: its error stages run before its finalize stages.
const FLOW_PHASES: readonly FlowPhase[] = ['pre', 'execute', 'post', 'error', 'finalize'];

/** A stage's list with the hooks that joined it while `step` ran moved right after `step`, where they start. */
function listJoinedAfterStep<C>(
  list: StageEntry<C>[],
  present: readonly StageEntry<C>[],
  step: StageEntry<C>,
): StageEntry<C>[] {
  const stepIndex = list.indexOf(step);
  if (stepIndex === -1) return list;
  const joinedBefore = list.slice(0, stepIndex).filter((entry) => !present.includes(entry));
  const rest = list.filter((entry) => !joinedBefore.includes(entry));
  rest.splice(rest.indexOf(step) + 1, 0, ...joinedBefore);
  return rest;
}

/** The order after the last entry of a stage map, where hooks merged into it start. */
function nextStageOrder<C>(stages: StageMap<C>): number {
  return Math.max(0, ...Object.values(stages).flatMap((list) => list.map((e) => e._order ?? 0))) + 1;
}

export class FlowInstance<Name extends FlowName> extends FlowEntry<Name> {
  readonly deps: Reference[];
  readonly globalProviders: ProviderRegistry;
  private plan: FlowPlan<never>;
  private FlowClass: FlowType;
  private flowClassLoad?: Promise<void>;
  private stages: StageMap<FlowType>;
  private hooks: HookRegistry;
  private readonly logger: FrontMcpLogger;
  private baseStageOrderEnd?: number;
  /** In dev mode or with DEBUG only: per hook owner, the entry classes (`undefined`: none) whose hook order is logged. */
  private readonly loggedHookOrders =
    isDevelopment() || isDebug() ? new Map<string | undefined, Set<Token | undefined>>() : undefined;

  constructor(scope: ScopeEntry, record: FlowRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(scope, record);
    this.deps = [...deps];
    this.globalProviders = globalProviders;
    this.FlowClass = this.record.provide;
    this.ready = this.initialize();
    this.plan = this.record.metadata.plan;
    this.hooks = scope.hooks;
    this.logger = scope.logger.child('FlowInstance');
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

        // Get context storage to wrap entire flow in FrontMcpContext
        const contextStorage = this.getContextStorage();

        try {
          // Use runWithContext to wrap entire flow execution in AsyncLocalStorage context
          // This ensures all stages have access to FrontMcpContext
          const result = await this.runWithContext(
            contextStorage,
            request,
            { request, response, next } as any,
            new Map(),
          );
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
          // A deployment that is merely missing a secret (MCP_SESSION_SECRET,
          // JWT_SECRET) answers the same structured `server_misconfigured` body on
          // every adapter, not a bare 500 (#546, #646).
          const misconfiguration = findMisconfiguration(e);
          if (misconfiguration) {
            this.logger.error('Server misconfigured', { flow: this.name, code: misconfiguration.code });
            return writeHttpResponse(response, {
              kind: 'json',
              status: 500,
              body: misconfigurationBody(misconfiguration),
            });
          }
          // Public MCP errors carry a client-safe status + message (e.g. a 401
          // from ensureAuthInfo when a verified token's session can't be
          // reconstructed — #471). Render them with their real status instead
          // of masking everything as a 500, and forward an RFC 6750
          // `WWW-Authenticate` challenge when the error supplies one.
          if (e instanceof PublicMcpError) {
            const challenge = e.wwwAuthenticate;
            this.logger.warn('Public error in flow', {
              flow: this.name,
              name: e.name,
              status: e.statusCode,
              code: e.code,
            });
            return writeHttpResponse(response, {
              kind: 'json',
              status: e.statusCode,
              body: { error: e.getPublicMessage() },
              ...(typeof challenge === 'string' && challenge.length > 0
                ? { headers: { 'WWW-Authenticate': challenge } }
                : {}),
            });
          }
          // Log unhandled errors for visibility (non-FlowControl errors indicate bugs)
          this.logger.error('Unhandled error in flow', {
            flow: this.name,
            name: e instanceof Error ? e.name : 'UnknownError',
            message: e instanceof Error ? e.message : String(e),
          });
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

  /** Loads the class of a flow registered with `deferredFlow`, and takes its metadata, plan and stages. */
  private loadFlowClass(): Promise<void> {
    const load = deferredFlowLoader(this.FlowClass);
    if (!load) return Promise.resolve();
    this.flowClassLoad ??= load().then((flowClass) => {
      Object.assign(this.metadata, collectFlowMetadata(flowClass));
      this.plan = this.metadata.plan;
      this.stages = collectFlowHookMap(flowClass);
      this.FlowClass = flowClass;
    });
    return this.flowClassLoad;
  }

  async canActivate(request: ServerRequest): Promise<boolean> {
    if (this.method && request.method !== this.method) return false;
    try {
      await this.loadFlowClass();
    } catch {
      // The route is the flow's: its run throws the same error, which the adapter answers with a 500
      return true;
    }

    const canActivate = [...(this.metadata.middleware?.canActivate ?? [])];
    if ((this.FlowClass as any)['canActivate']) {
      canActivate.push((this.FlowClass as any)['canActivate']);
    }
    if (canActivate.length === 0) return true;

    const results = await Promise.all(canActivate.map((m) => m(request, this.scope)));
    return results.every((r) => r);
  }

  /**
   * Express-equivalent HTTP match for runtimes that have NO middleware server
   * (the Cloudflare Worker / web-fetch handler, where `registerMiddleware` is a
   * no-op so flows never mount as routes). It mirrors how Express dispatches:
   * method + `middleware.path` (mounted as a prefix) + `canActivate`.
   *
   * Only flows with a SPECIFIC matcher qualify — a `middleware.path` (e.g.
   * `/oauth/token`) and/or a `canActivate` (static class method or
   * `middleware.canActivate`, e.g. the well-known PRM path set). A bare
   * `{ method }` middleware is too broad to safely claim an arbitrary request,
   * so it returns false. Used by the web-fetch handler to serve auth/well-known/
   * oauth endpoints through the real flow pipeline.
   */
  async matchHttp(request: ServerRequest): Promise<boolean> {
    const mw = this.metadata.middleware;
    if (!mw) return false;
    const path = typeof mw.path === 'string' ? mw.path : '';
    const hasStaticCanActivate =
      typeof (this.FlowClass as unknown as { canActivate?: unknown }).canActivate === 'function';
    const hasMwCanActivate = (mw.canActivate?.length ?? 0) > 0;
    if (!path && !hasStaticCanActivate && !hasMwCanActivate) return false;
    if (this.method && request.method !== this.method) return false;
    const captured = path ? matchMountedPath(path, request.path) : {};
    if (!captured) return false;

    // As Express does on a route match, the path's parameters become the request's `params`
    // (`/oauth/provider/:providerId/callback`). Values the adapter already set win, and a flow that
    // turns the request down leaves `params` as it found it for the next flow to try.
    const previous = request.params;
    if (Object.keys(captured).length > 0) request.params = { ...captured, ...previous };
    const activated = await this.canActivate(request);
    if (!activated) {
      if (previous === undefined) delete request.params;
      else request.params = previous;
    }
    return activated;
  }

  /**
   * Get FrontMcpContextStorage from providers (with fallback).
   * Returns undefined if not available (backward compatibility).
   */
  private getContextStorage(): FrontMcpContextStorage | undefined {
    try {
      return this.globalProviders.get(FrontMcpContextStorage);
    } catch {
      this.logger.verbose('getContextStorage: FrontMcpContextStorage not available');
      return undefined;
    }
  }

  /**
   * Run flow wrapped in FrontMcpContext.
   * This ensures ALL stages have access to the context via AsyncLocalStorage.
   *
   * @param storage - FrontMcpContextStorage instance
   * @param request - The HTTP request
   * @param input - Flow input
   * @param deps - Flow dependencies
   * @returns Flow output or undefined
   */
  private async runWithContext(
    storage: FrontMcpContextStorage | undefined,
    request: ServerRequest,
    input: FlowInputOf<Name>,
    deps: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined> {
    // If no storage available, run without context (backward compatibility)
    if (!storage) {
      return this.run(input, deps);
    }

    const scope = this.globalProviders.getActiveScope();

    // Wrap ENTIRE flow execution in AsyncLocalStorage context. The socket peer is the only
    // client address a caller cannot forge (GHSA-p3qf-fcwm-35x4).
    return storage.runForHttpRequest(request, scope.id, async () => {
      return this.run(input, deps);
    });
  }

  async run(input: FlowInputOf<Name>, deps: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined> {
    this.logger.verbose(`run: starting flow '${this.name}'`);
    await this.loadFlowClass();
    const scope = this.globalProviders.getActiveScope();

    // Build provider views for scoped DI
    // This enables CONTEXT scoped providers to be resolved
    const contextStorage = this.getContextStorage();
    const currentContext = contextStorage?.getStore();
    // Get session ID from context - should always be available since runWithContext wraps the entire flow
    // If unavailable, it indicates a bug in context propagation (not a normal case)
    const sessionKey = currentContext?.sessionId;
    if (!currentContext || !sessionKey) {
      // This should never happen since runWithContext wraps the entire flow execution
      // If we reach here, there's a bug in context propagation
      throw new RequestContextNotAvailableError(
        'FrontMcpContext unavailable - session ID required for provider resolution. Ensure flow is wrapped with runWithContext.',
      );
    }

    // `this.context.flow` and `this.context.scope` name the innermost flow running in this async call chain
    const runStages = () =>
      runAsFlow({ context: currentContext, flow: this, scope }, () =>
        this.runStages(input, deps, scope, currentContext, sessionKey),
      );
    const responseHeaders = this.metadata.middleware?.responseHeaders;
    return responseHeaders ? this.respondWithHeaders(runStages, responseHeaders) : runStages();
  }

  /**
   * Run the stages of a route whose every response carries `headers`, whichever stage, hook or guard
   * responded. A failure is answered here, with the headers, rather than by the adapter.
   */
  private async respondWithHeaders(
    runStages: () => Promise<FlowOutputOf<Name> | undefined>,
    headers: Readonly<Record<string, string>>,
  ): Promise<FlowOutputOf<Name> | undefined> {
    let output: HttpOutput | undefined;
    try {
      output = (await runStages()) as HttpOutput | undefined;
    } catch (error) {
      output = flowErrorToHttpOutput(error);
      if (!output) throw error;
      this.logger.error('Flow failed', {
        flow: this.name,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return output && (withHttpHeaders(output, headers) as FlowOutputOf<Name>);
  }

  private async runStages(
    input: FlowInputOf<Name>,
    deps: Map<Token, Type>,
    scope: ScopeEntry,
    currentContext: FrontMcpContext,
    sessionKey: string,
  ): Promise<FlowOutputOf<Name> | undefined> {
    const { FlowClass, plan, name } = this;

    // Build views with current context if available
    // Include context tokens (e.g., ORCHESTRATED_AUTH_ACCESSOR) for DI resolution
    const contextProviders = new Map<Token, unknown>([[FRONTMCP_CONTEXT as Token, currentContext]]);
    // Merge context tokens registered by auth flows (e.g., ORCHESTRATED_AUTH_ACCESSOR)
    for (const [token, value] of currentContext.getContextTokens()) {
      contextProviders.set(token as Token, value);
    }
    const views = await this.globalProviders.buildViews(sessionKey, contextProviders);

    // Merge context-scoped providers into deps for resolution by FlowClass
    const mergedDeps = new Map(deps);
    for (const [token, instance] of views.context) {
      mergedDeps.set(token, instance as Type);
    }

    // The class's stage map is shared by every run: a run that merges hooks clones it first.
    const baseStages = this.stages;
    let stages: StageMap<any> = baseStages;
    let ownsStages = false;

    // Compute next order base after any class-defined entries.
    let orderBase = (this.baseStageOrderEnd ??= nextStageOrder(baseStages));

    const hookOwnerId = await (FlowClass as typeof FlowBase).resolveHookOwnerId?.(input, scope);
    // The entry class's `static` hooks need no instance, so they join from the first stage (#701).
    const entryClass = await (FlowClass as typeof FlowBase).resolveHookEntryClass?.(input, scope);
    const entryStaticHooks = entryClass ? staticHooksFor(this.hooks.getClsHooks(entryClass), name) : [];

    // A hook declared on a CONTEXT-scoped provider runs on this run's instance of that provider.
    const initialInjectedHooks = await bindContextHookTargets(
      (this.hooks.getFlowHooksForOwner(name, hookOwnerId) as HookEntry<
        FlowInputOf<Name>,
        Name,
        FlowStagesOf<Name>,
        FlowCtxOf<Name>
      >[]) ?? [],
      { sessionKey, contextProviders: mergedDeps, contextSource: this.globalProviders },
    );

    let contextReady = false;

    const runHook: HookRunner = (hook, run) => {
      const observe = currentContext.get<HookObserver>(HOOK_OBSERVER_KEY);
      return observe ? observe({ ...hook, flowName: name, flowContext: context }, run) : run();
    };

    const materializeAndMerge = async (
      newHooks: Array<Pick<HookEntry, 'metadata'>>,
      opts?: { orderStart?: number },
    ) => {
      if (!newHooks?.length || !contextReady) return;

      const metas: HookMetadata[] = [];
      for (const h of newHooks) {
        try {
          metas.push(h.metadata);
        } catch (e) {
          this.logger.warn('Ignoring injected hook that failed to materialize', {
            flow: this.name,
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      }

      if (metas.length) {
        const start = opts?.orderStart ?? orderBase;
        if (!ownsStages) {
          stages = cloneStageMap(baseStages);
          ownsStages = true;
        }
        mergeHookMetasIntoStageMap(FlowClass, stages, metas, start, runHook);
        if (opts?.orderStart === undefined) orderBase += metas.length;
      }
    };

    const appendContextHooks = async (hooks: Array<Pick<HookEntry, 'metadata'>>) => {
      await materializeAndMerge(hooks);
    };

    // Construct flow instance with merged dependencies (includes scoped providers)

    // FlowClass generic type is erased at runtime, so we use FlowBase<any>
    // to avoid complex type gymnastics while maintaining basic type safety
    const context: FlowBase<any> = new FlowClass(this.metadata, input, scope, appendContextHooks, mergedDeps);

    // Now injections can materialize
    contextReady = true;

    // Initial registry hooks should not pre-empt stages; they just get registered
    await materializeAndMerge(initialInjectedHooks, { orderStart: -1_000_000 });

    // Refresh order base to be after everything currently present
    if (ownsStages) orderBase = nextStageOrder(stages);

    // The target entry's static hooks follow the registry's hooks of the same priority, as its
    // instance hooks do when the stage that builds the instance appends them.
    await materializeAndMerge(entryStaticHooks);

    if (this.loggedHookOrders) this.logHookOrderOnce(this.loggedHookOrders, stages, hookOwnerId, entryClass);

    let responded: FlowOutputOf<Name> | undefined;

    const toStageResult = (e: unknown): StageResult => {
      if (e instanceof FlowControl) {
        if (e.type === 'respond') {
          responded = e.output as FlowOutputOf<Name>;
          const status = (e.output as { status?: unknown } | undefined)?.status;
          // Finalize stages and their hooks read the HTTP status of the latest response from `state.statusCode`
          context.state.set('statusCode' as never, (typeof status === 'number' ? status : undefined) as never);
        }
        return { outcome: e.type, control: e };
      }
      return { outcome: 'unknown_error', control: e as Error };
    };

    // Whether any stage body or hook is registered under `key` right now.
    const hasEntries = (key: string): boolean => (stages[key]?.length ?? 0) > 0;

    // A Finally hook cannot respond or fail its stage: what it throws is logged and dropped.
    const ignoreFinallyThrow = (key: string, thrown: unknown) => {
      const description = thrown instanceof FlowControl ? `FlowControl '${thrown.type}'` : describeValue(thrown);
      this.logger.warn(`Ignored a throw from a Finally hook of '${key}': it cannot change the stage's outcome`, {
        flow: name,
        thrown: description,
      });
    };

    // The values a Finally hook set on the state before the throw the runner drops, such as a job's answer, are put back
    const restoreState = (before: Readonly<Record<string, unknown>>) => {
      const state = context.state as unknown as Record<string, unknown>;
      for (const key of Object.keys(context.state.snapshot())) {
        if (!(key in before)) delete state[key];
      }
      context.state.set(before as never);
    };

    // Robust list runner (doesn't skip mid-run insertions)
    const runList = async (
      key: string,
      opts?: { ignoreRespond?: boolean; ignoreThrows?: boolean },
    ): Promise<StageResult> => {
      const seen = new Set<any>();

      while (true) {
        const list = ((stages as any)[key] ?? []) as StageMap<any>[string];
        let item: StageMap<any>[string][number] | undefined;
        for (const entry of list) {
          if (!seen.has(entry)) {
            item = entry;
            break;
          }
        }
        if (!item) break;
        seen.add(item);

        const stateBefore = opts?.ignoreThrows ? (context.state.snapshot() as Record<string, unknown>) : undefined;
        try {
          await item.method(context);
        } catch (e: any) {
          if (opts?.ignoreThrows) {
            if (stateBefore) restoreState(stateBefore);
            ignoreFinallyThrow(key, e);
            continue;
          }
          if (e instanceof FlowControl && e.type === 'respond' && opts?.ignoreRespond) continue;
          return toStageResult(e);
        }
      }
      return { outcome: 'ok' };
    };

    // Each Around hook's next() runs the next Around hook, and the innermost one runs the stage body.
    // next() rejects when the body fails, so an Around hook can catch, retry or rethrow.
    const runAroundChain = async (stageName: string, index = 0): Promise<StageResult> => {
      const around = ((stages as any)[stageKeysOf(stageName).around] ?? [])[index] as
        | StageMap<any>[string][number]
        | undefined;
      if (!around) return runList(stageName, { ignoreRespond: false });

      let innerResult: StageResult = { outcome: 'ok' };
      const next = async () => {
        innerResult = await runAroundChain(stageName, index + 1);
        if (innerResult.outcome !== 'ok' && innerResult.outcome !== 'respond') throw innerResult.control;
      };
      try {
        await around.method(context, next);
      } catch (e) {
        return toStageResult(e);
      }
      // Returning normally after a rejected next() means the hook handled that failure.
      return FAILED_OUTCOMES.has(innerResult.outcome) ? { outcome: 'ok' } : innerResult;
    };

    // `state.flowError` keeps the run's first failure (a thrown Error, a `fail()` or an abort) for what runs after it
    const recordFailure = (control: unknown) => {
      if (context.state.get('flowError' as never)) return;
      const failure = control instanceof FlowControl ? failureOf(control) : control;
      const flowError =
        failure instanceof Error
          ? failure
          : new InternalMcpError(`Flow failed with a non-Error value: ${describeValue(failure)}`);
      context.state.set('flowError' as never, flowError as never);
    };

    // Run exactly one stage in order: will → around(stage) → did (did runs once)
    // An empty hook list is skipped without a call: running it would only return 'ok'.
    const runStageSteps = async (stageName: string, stopOnRespond: boolean): Promise<StageResult> => {
      const keys = stageKeysOf(stageName);
      // 1) willStage
      if (hasEntries(keys.will)) {
        const res = await runList(keys.will);
        if (res.outcome === 'respond' && stopOnRespond) return res;
        if (res.outcome !== 'ok' && res.outcome !== 'respond') return res;
      }

      // 2) stage, wrapped by its Around hooks
      const bodyOutcome = hasEntries(keys.around)
        ? await runAroundChain(stageName)
        : await runList(stageName, { ignoreRespond: false });
      if (bodyOutcome.outcome !== 'ok' && bodyOutcome.outcome !== 'respond') {
        // fail/abort/next/handled/unknown → do NOT run did
        return bodyOutcome;
      }

      // 3) didStage (run once regardless of body respond)
      if (hasEntries(keys.did)) {
        const res = await runList(keys.did, { ignoreRespond: true });
        if (res.outcome !== 'ok' && res.outcome !== 'respond') return res;
      }

      if (bodyOutcome.outcome === 'respond') return bodyOutcome;
      return { outcome: 'ok' };
    };

    // Then the stage's Finally hooks run, whatever its outcome, with its failure recorded for them.
    const runOneStage = async (stageName: string, stopOnRespond: boolean): Promise<StageResult> => {
      const result = await runStageSteps(stageName, stopOnRespond);
      if (FAILED_OUTCOMES.has(result.outcome)) recordFailure(result.control);
      const finallyKey = stageKeysOf(stageName).finally;
      if (hasEntries(finallyKey)) await runList(finallyKey, { ignoreThrows: true });
      return result;
    };

    // IMPORTANT: ignore typed stage names in plan arrays.
    // Only base stage names in the plan drive execution; typed hooks run *with* their base.
    const runStageGroup = async (
      group: Array<string> | undefined,
      stopOnRespond: boolean,
      opts?: { ignoreRespond?: boolean },
    ): Promise<StageResult> => {
      if (!group || group.length === 0) return { outcome: 'ok' };

      for (const base of stageBasesOf(group)) {
        const res = await runOneStage(base, stopOnRespond);
        if (res.outcome === 'respond') {
          if (stopOnRespond) return res;
          // else keep going
        } else if (res.outcome !== 'ok') {
          return res;
        }
      }
      return { outcome: 'ok' };
    };

    const runErrorStage = async () => {
      await runStageGroup((plan as any).error, false, { ignoreRespond: true });
    };

    const runFinalizeStage = async (options?: { suppressErrors?: boolean }) => {
      const res = await runStageGroup((plan as any).finalize, false);
      // Handle finalize stage errors
      if (res.outcome === 'unknown_error' || res.outcome === 'fail') {
        const finalizeError = res.control ?? new InternalMcpError('Finalize stage failed');
        if (options?.suppressErrors) {
          // Log finalizes errors but doesn't throw when called from finally blocks
          // This prevents masking the original error
          this.scope.logger.error(
            '[FrontMCP] Finalize stage error (suppressed to preserve original error):',
            finalizeError,
          );
          return res;
        }
        throw finalizeError;
      }
      return res;
    };

    // ---------- PRE ----------
    {
      const pre = await runStageGroup((plan as any).pre, true);
      this.logger.verbose(`run: PRE completed, outcome=${pre.outcome}`);
      if (pre.outcome === 'respond') {
        const post = await runStageGroup((plan as any).post, false);
        if (post.outcome === 'unknown_error' || post.outcome === 'fail') {
          try {
            await runErrorStage();
          } finally {
            await runFinalizeStage({ suppressErrors: true });
          }
          throw post.control ?? new InternalMcpError('Missing control for fail/error outcome');
        }
        if (post.outcome === 'abort' || post.outcome === 'next' || post.outcome === 'handled') {
          await runFinalizeStage({ suppressErrors: true });
          if (!(post.control instanceof FlowControl)) {
            throw new InternalMcpError('Expected FlowControl but received different error type');
          }
          throw post.control;
        }
        await runFinalizeStage();
        return responded;
      }
      if (pre.outcome === 'unknown_error' || pre.outcome === 'fail') {
        try {
          await runErrorStage();
        } finally {
          await runFinalizeStage({ suppressErrors: true });
        }
        throw pre.control ?? new InternalMcpError('Missing control for fail/error outcome');
      }
      if (pre.outcome === 'abort' || pre.outcome === 'next' || pre.outcome === 'handled') {
        await runFinalizeStage({ suppressErrors: true });
        if (!(pre.control instanceof FlowControl)) {
          throw new InternalMcpError('Expected FlowControl but received different error type');
        }
        throw pre.control;
      }
    }

    // ---------- EXECUTE ----------
    if (!responded) {
      const exec = await runStageGroup((plan as any).execute, true);
      this.logger.verbose(`run: EXECUTE completed, outcome=${exec.outcome}`);
      if (exec.outcome === 'respond') {
        // continue to post + finalize
      } else if (exec.outcome === 'unknown_error' || exec.outcome === 'fail') {
        try {
          await runErrorStage();
        } finally {
          await runFinalizeStage({ suppressErrors: true });
        }
        throw exec.control ?? new InternalMcpError('Missing control for fail/error outcome');
      } else if (exec.outcome === 'abort' || exec.outcome === 'next' || exec.outcome === 'handled') {
        await runFinalizeStage({ suppressErrors: true });
        if (!(exec.control instanceof FlowControl)) {
          throw new InternalMcpError('Expected FlowControl but received different error type');
        }
        throw exec.control;
      }
    }

    // ---------- POST ----------
    {
      const post = await runStageGroup((plan as any).post, false);
      this.logger.verbose(`run: POST completed, outcome=${post.outcome}`);
      if (post.outcome === 'unknown_error' || post.outcome === 'fail') {
        try {
          await runErrorStage();
        } finally {
          await runFinalizeStage({ suppressErrors: true });
        }
        throw post.control ?? new InternalMcpError('Missing control for fail/error outcome');
      }
      if (post.outcome === 'abort' || post.outcome === 'next' || post.outcome === 'handled') {
        await runFinalizeStage({ suppressErrors: true });
        if (!(post.control instanceof FlowControl)) {
          throw new InternalMcpError('Expected FlowControl but received different error type');
        }
        throw post.control;
      }
    }

    // ---------- FINALIZE ----------
    await runFinalizeStage();

    return responded;
  }

  /** Logs the order the run's hooks resolve to, on the first run for its hook owner and its entry class's hooks. */
  private logHookOrderOnce(
    logged: Map<string | undefined, Set<Token | undefined>>,
    stages: StageMap<FlowType>,
    ownerId: string | undefined,
    entryClass: Token | undefined,
  ): void {
    const entryHooks = entryClass
      ? this.hooks.getClsHooks(entryClass).filter((hook) => hook.metadata.flow === this.name)
      : [];
    const entryKey = entryHooks.length > 0 ? entryClass : undefined;
    const loggedEntries = logged.get(ownerId) ?? new Set<Token | undefined>();
    if (loggedEntries.has(entryKey)) return;
    logged.set(ownerId, loggedEntries.add(entryKey));

    // The entry's instance hooks join when its context is built: merge them where they will land.
    const resolved = cloneStageMap(stages);
    const instanceHooks = entryHooks.filter((hook) => !hook.metadata.static).map((hook) => hook.metadata);
    mergeHookMetasIntoStageMap(this.FlowClass, resolved, instanceHooks, nextStageOrder(stages));
    const contextStage = entryContextStageOf(this.name);
    const contextStep = contextStage ? this.stages[contextStage]?.[0] : undefined;
    if (contextStage && contextStep && resolved[contextStage]) {
      resolved[contextStage] = listJoinedAfterStep(resolved[contextStage], stages[contextStage] ?? [], contextStep);
    }
    const stageNames = FLOW_PHASES.flatMap((phase) => {
      const group = this.plan[phase];
      return group ? stageBasesOf(group) : [];
    });
    const lines = describeHookOrder(stageNames, this.stages, resolved, this.FlowClass.name);
    if (lines.length === 0) return;

    const owner = ownerId === undefined ? '' : ` for '${ownerId}'`;
    const entry = entryKey === undefined ? '' : ` and ${tokenName(entryKey)}`;
    const header = `Hook order of '${this.name}'${owner}${entry}, lowest priority first (an around hook wraps what its brackets hold):`;
    this.logger.info([header, ...lines].join('\n'));
  }
}
