// file: libs/sdk/src/hooks/hook-observers.ts

import { FlowControl, type HookStageType } from '../common';

/**
 * Where a request's hook observers live on its `FrontMcpContext`. A `Symbol.for` key, so every copy of the SDK and
 * `@frontmcp/observability` read the same chain.
 */
export const HOOK_OBSERVER_KEY = Symbol.for('frontmcp:hook-observer');

/** Where a tool, resource or prompt answer carries the dev hook trace. */
export const HOOK_TRACE_META_KEY = 'frontmcp/trace';

/** A hook a plugin, provider, app or entry injected into a flow, as its observers see it. */
export interface ObservedHook {
  flowName: string;
  /** The key the hook runs under: `execute` for a Stage hook, `willExecute`, `aroundExecute`, `didExecute`... */
  stage: string;
  type: HookStageType;
  /** The `name` of the plugin that registered the hook, else the name of the class that declares it. */
  owner: string;
  method: string;
  /** The object the hook's method runs on. */
  target: unknown;
  /** The flow run the hook is part of. */
  flowContext: unknown;
}

/** Wraps one hook run: `run` runs the hook, at most once whatever the observer does, and its outcome is the hook's. */
export type HookObserver = (hook: ObservedHook, run: () => Promise<void>) => Promise<void>;

/** The request store observers are kept in: a `FrontMcpContext`, or anything with its `get` / `set`. */
export interface HookObserverHost {
  get(key: symbol): unknown;
  set(key: symbol, value: unknown): void;
}

const NO_OBSERVERS: readonly HookObserver[] = [];

function isObserverChain(value: unknown): value is readonly HookObserver[] {
  return Array.isArray(value) && value.every((observer) => typeof observer === 'function');
}

/** The observers installed on a request, in install order. A single function under the key counts as one. */
export function observersOf(context: HookObserverHost): readonly HookObserver[] {
  const installed = context.get(HOOK_OBSERVER_KEY);
  if (typeof installed === 'function') return [installed as HookObserver];
  return isObserverChain(installed) ? installed : NO_OBSERVERS;
}

/** Adds `observer` to the request's chain, inside the observers added before it, unless it is there already. */
export function addHookObserver(context: HookObserverHost, observer: HookObserver): void {
  const observers = observersOf(context);
  if (!observers.includes(observer)) context.set(HOOK_OBSERVER_KEY, [...observers, observer]);
}

/**
 * Runs `run` inside each of `observers`, the first outermost. What an observer throws is passed to `onObserverError`
 * and dropped: the hook still runs once, and settles as it would with no observer.
 */
export function runObservedHook(
  observers: readonly HookObserver[],
  hook: ObservedHook,
  run: () => Promise<void>,
  onObserverError: (error: unknown, observer: HookObserver) => void = () => undefined,
): Promise<void> {
  const runFrom = async (index: number): Promise<void> => {
    const observer = observers[index];
    if (!observer) return run();
    let inner: Promise<void> | undefined;
    const runInner = (): Promise<void> => {
      if (!inner) {
        inner = runFrom(index + 1);
        // Handled here so an observer that does not await it leaves no unhandled rejection: it settles below.
        inner.catch(() => undefined);
      }
      return inner;
    };
    try {
      await observer(hook, runInner);
    } catch (error) {
      const innerError =
        inner &&
        (await inner.then(
          () => undefined,
          (failure: unknown) => ({ failure }),
        ));
      if (!innerError || innerError.failure !== error) onObserverError(error, observer);
    }
    return runInner();
  };
  return runFrom(0);
}

export type HookTraceOutcome = 'ok' | 'respond' | 'next' | 'handled' | 'fail' | 'abort' | 'error';

/** One hook of a call, in `_meta['frontmcp/trace']`: who ran it, where, how long it took and how it ended. */
export interface HookTraceEntry {
  owner: string;
  method: string;
  /** The plan stage the hook is declared on, such as `execute`. */
  stage: string;
  type: HookStageType;
  ms: number;
  outcome: HookTraceOutcome;
}

function planStageOf(hook: ObservedHook): string {
  if (hook.type === 'stage') return hook.stage;
  const stage = hook.stage.slice(hook.type.length);
  return stage ? stage[0].toLowerCase() + stage.slice(1) : hook.stage;
}

function outcomeOf(thrown: unknown): HookTraceOutcome {
  return thrown instanceof FlowControl ? thrown.type : 'error';
}

/** An observer that appends each hook it wraps to `trace` when the hook starts, and its time and outcome when it ends. */
export function recordHookTrace(trace: HookTraceEntry[]): HookObserver {
  return async (hook, run) => {
    const entry: HookTraceEntry = {
      owner: hook.owner,
      method: hook.method,
      stage: planStageOf(hook),
      type: hook.type,
      ms: 0,
      outcome: 'ok',
    };
    trace.push(entry);
    const started = performance.now();
    try {
      await run();
    } catch (thrown) {
      entry.outcome = outcomeOf(thrown);
      throw thrown;
    } finally {
      entry.ms = Math.round((performance.now() - started) * 1000) / 1000;
    }
  };
}

/** A copy of `answer` whose `_meta` carries `trace`; anything but an object is returned as it is. */
export function withHookTrace<T>(answer: T, trace: HookTraceEntry[]): T {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return answer;
  const meta = (answer as { _meta?: Record<string, unknown> })._meta;
  return { ...answer, _meta: { ...meta, [HOOK_TRACE_META_KEY]: trace } };
}
