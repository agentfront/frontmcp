import {
  NextFn,
  ServerRequestHandler,
  ServerRequest,
  ServerResponse,
  ProviderScope,
  Token,
  Type, HttpOutput,
} from '@frontmcp/sdk';
import { FlowName } from '../plugin/plugin.types';
import { AppLocalInstance } from '../app/instances';
import { Scope } from '../scope';

/**
 * Base context contract that matches InvokerContext while staying backward-compatible.
 *
 * Generic params mirror InvokerContext:
 *  - TRawIn: transport/raw input (HTTP req, DB row, etc.)
 *  - TIn: validated input (post-Zod)
 *  - TOut: validated output (post-Zod)
 *  - TErr: error type
 *  - TRunId: run id type
 *  - TInDraft: normalized-but-untrusted input
 *  - TOutDraft: normalized-but-untrusted output
 */
export interface InvokeBaseContext<
  TRawIn = unknown,
  TIn = unknown,
  TOut = unknown,
  TErr = unknown,
  TRunId = string,
  TInDraft = Partial<TIn>,
  TOutDraft = Partial<TOut>,
> {
  // ---- core
  runId: TRunId;
  data: Map<string, unknown>;
  activeStage?: string;
  phase: InvokePhase;

  // ---- timing (present in InvokerContext; optional here to keep looser impls valid)
  startTime?: number;

  // ---- payloads (match InvokerContext names)
  rawInput?: TRawIn;
  inputDraft?: TInDraft;
  outputDraft?: TOutDraft;

  // validated payloads
  input: TIn | undefined;
  output: TOut;

  // aliases (InvokerContext exposes these as accessors)
  validatedInput?: TIn | undefined;
  validatedOutput?: TOut | undefined;

  // error
  error: TErr | undefined;

  scope: Scope; // TODO: change to scope

  // ---- DI helpers (InvokerContext provides these; optional in base)
  get?<X>(token: Token<X>): X;

  bindProvider?<X>(token: Token<X>, value: X, scope: ProviderScope): void;

  // ---- control helpers
  respond(v: TOut): never;

  fail(err: unknown): never;

  // ---- instrumentation
  mark(stage: string, phase: InvokePhase): void;
}

export type AwaitedT<T> = T extends Promise<infer U> ? U : T;

export type CapitalizeStr<S extends string> = S extends `${infer H}${infer T}` ? `${Uppercase<H>}${T}` : S;

export type Prefixed<Base extends string> = `${'will' | 'around' | 'did'}${CapitalizeStr<Base>}`;

export type AllStages<Base extends string> = Base | Prefixed<Base>;

export type StepInfo = string | { title?: string; description?: string; skippable?: boolean };

export type InvokePhase = 'pre' | 'execute' | 'post' | 'finalize' | 'error';

export type RunPlan<Base extends string> = {
  name: FlowName;
  steps?: Record<Base, StepInfo>;
} & Record<InvokePhase, Base[]>;

export type HooksByStage = Partial<Record<string, Type[]>>;

// Entries contributed to hooks-by-stage maps can be either class Types or direct hook objects

export type InvokerHook<Ctx extends InvokeBaseContext, Stage extends string> = {
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  priority?: number | (() => number);
  aroundExecute?: (ctx: Ctx, next: () => Promise<unknown>) => Promise<unknown>;
} & Partial<Record<Stage, StageFn<Ctx>>>;

export type CollectorOptions<Ctx extends InvokeBaseContext, Stage extends string> = {
  resolve?: <T>(cls: Type<T>) => T;
  pluginHooksByStage: Partial<Record<AllStages<Stage>, Type[]>>;
  localHooksByStage?: Partial<Record<AllStages<Stage>, Type[]>>;
  fnHooksProvider?: (
    stage: AllStages<Stage>,
  ) => InvokerHook<Ctx, AllStages<Stage>>[] | Promise<InvokerHook<Ctx, AllStages<Stage>>[]>;
  ctx: Ctx;
};

export type RunStageOptions<Ctx extends InvokeBaseContext, Stage extends string> = CollectorOptions<Ctx, Stage> & {
  collectOnly?: boolean;
};

export type HookCollector<Stage extends string, Ctx extends InvokeBaseContext = InvokeBaseContext> = (
  stage: AllStages<Stage>,
  args: CollectorOptions<Ctx, Stage>,
) => Promise<InvokerHook<Ctx, AllStages<Stage>>[]>;

export type SortForStage<Stage extends string = string, Ctx extends InvokeBaseContext = InvokeBaseContext> = (
  stage: AllStages<Stage>,
  hooks: InvokerHook<Ctx, AllStages<Stage>>[],
) => InvokerHook<Ctx, AllStages<Stage>>[];

export type StageFn<Ctx> = (ctx: Ctx) => void | Promise<void>;

export type InvokerOptions<Stage extends string, Ctx extends InvokeBaseContext = InvokeBaseContext> = {
  collector?: HookCollector<Stage, Ctx>;
  sortForStage?: SortForStage<Stage, Ctx>;
};

export type CollectorArgs<Stage extends string> = {
  resolve?: <T>(cls: any) => T;
  pluginHooksByStage: Partial<Record<AllStages<Stage>, any[]>>;
  localHooksByStage?: Partial<Record<AllStages<Stage>, any[]>>;
  fnHooksProvider?: (
    stage: AllStages<Stage>,
  ) => Promise<InvokerHook<InvokeBaseContext, AllStages<Stage>>[]> | InvokerHook<InvokeBaseContext, AllStages<Stage>>[];
  ctx: InvokeBaseContext;
};

export type FlowSpec<BaseStage extends string, Ctx extends InvokeBaseContext, InitArgs extends any[] = any[]> = {
  plan: RunPlan<BaseStage>;
  initContext: (...args: InitArgs) => Promise<Ctx>;
  bindProviders?: (bindings: [Token, unknown, ProviderScope][], ctx: Ctx) => Promise<void>;
  baseHandler: any;
};

// Extras you can pass as the final (optional) argument to runFlow(...)
export type RunExtras<BaseStage extends string, Ctx extends InvokeBaseContext = InvokeBaseContext> = {
  parent?: Ctx;
  resolve?: <X>(cls: any) => X;
  pluginHooksByStage?: Partial<Record<AllStages<BaseStage>, any>>;
  localHooksByStage?: Partial<Record<AllStages<BaseStage>, any>>;
  fnHooksProvider?: (stage: AllStages<BaseStage>) => any;
  isControlRespond?: (e: unknown) => e is { value: unknown };
};

// Turn a union into an intersection
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

// Expand one stage into its contribution
type ExpandStage<K extends string> =
// skip initContext entirely
  K extends 'initContext'
    ? Record<never, never>
    : // bindProviders -> only did*
    K extends 'bindProviders'
      ? { [P in `did${Capitalize<K>}`]: `did${Capitalize<K>}` }
      : // everyone else -> will/around/did
      { [P in `will${Capitalize<K>}` | `around${Capitalize<K>}` | `did${Capitalize<K>}`]: P };

// Final generator
export type GenerateFromArray<A extends readonly string[]> = UnionToIntersection<ExpandStage<A[number]>>;

export type ProviderBinding = [Token, unknown, ProviderScope];

/** Lazily produce bindings for the current run & ctx. */
export type BindingsGetter<Ctx extends InvokeBaseContext = InvokeBaseContext> = (args: {
  ctx: Ctx;
  apps?: AppLocalInstance[];
  app?: AppLocalInstance;
}) => Promise<ProviderBinding[] | undefined> | ProviderBinding[] | undefined;

/** Bundle of base getters the Invoker should use. */
export type ProvidersConfig<Ctx extends InvokeBaseContext = InvokeBaseContext> = {
  /** Always used (after hook-provided getters). */
  baseGetters?: BindingsGetter<Ctx>[];
  /** Build getters from an app list (used when you pass extras.apps into a run). */
  fromApps?: (apps: AppLocalInstance[]) => BindingsGetter<Ctx>[];
  /** Build getters from a single app. */
  fromApp?: (app: AppLocalInstance) => BindingsGetter<Ctx>[];
  /** How to pull session/request keys out of the context. */
  scopeKeysFromCtx?: (ctx: Ctx) => { sessionId?: string; requestId?: string | number };
};

/** Extend InvokerOptions with providers + default extras */
export interface InvokerOptionsWithProviders<
  BaseStage extends string,
  Ctx extends InvokeBaseContext = InvokeBaseContext,
> {
  providers?: ProvidersConfig<Ctx>;
  /** Inject INVOKER_BRAND_SYMBOL -> { invoker, extras } as a request-scoped provider during bootstrap. */
  invokerProvider?: boolean;
  /** Default extras merged into each run (caller can still override). */
  defaultExtras?: Partial<RunExtras<BaseStage>>;
}

/** Route-factory scope keys */
export type ScopeKeys = { sessionId?: string; requestId?: string | number };
export type ScopeKeyExtractor<Ctx = any> = (ctx: Ctx) => ScopeKeys;

/** Route-factory custom getters injection */
export type ProviderGettersOption<Ctx extends InvokeBaseContext = any> =
  | BindingsGetter<Ctx>[] // shorthand: all as BEFORE app getters
  | {
  /** Run BEFORE app getters (higher precedence vs app providers) */
  before?: BindingsGetter<Ctx>[];
  /** Run AFTER app getters (lower precedence vs app providers) */
  after?: BindingsGetter<Ctx>[];
};

export const INVOKER_BRAND_SYMBOL = Symbol('INVOKER_BRAND_SYMBOL');
export type CreateOptions = {
  scope: Scope;
  providerGettersOptions?: ProviderGettersOption;
};

export type Fail = {
  fail: (onFail: (res: ServerResponse, err: any, req: ServerRequest, next: NextFn) => void) => ServerRequestHandler;
};
export type Success<Out> = {
  success: (
    onSuccess: (res: ServerResponse, result: Out, req: ServerRequest, next: NextFn) => void,
  ) => ServerRequestHandler & Fail;
};

export type HandlerFn<In, Out> = (
  when: (req: ServerRequest, res: ServerResponse, next: NextFn) => In,
) => ServerRequestHandler & Success<Out>;

export class RunOptions<In, Out> {
  run: (options: In) => Promise<Out>;
  handler: HandlerFn<In, Out>;
  httpMiddleware: ServerRequestHandler;
}


export type HttpFlowRunOptions = RunOptions<{ request: ServerRequest, response: ServerResponse }, HttpOutput>;
