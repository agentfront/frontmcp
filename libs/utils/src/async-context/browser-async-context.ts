/**
 * Browser `AsyncLocalStorage`.
 *
 * A browser has no `node:async_hooks`, and native `await` resumes a function without passing
 * through anything userland can hook, so a store set before an `await` cannot follow the code that
 * runs after it. Two requests that overlap would otherwise read each other's store (request
 * context, auth info, the running tool, the call surface).
 *
 * - When the runtime provides TC39 `AsyncContext`, each storage is an `AsyncContext.Variable` and
 *   requests overlap freely (`getAsyncContextMode()` is `'native'`).
 * - Otherwise (`'serialized'`) top-level requests take turns: {@link runRequestExclusive} lets one
 *   request run at a time, and each request keeps its own stacks, so a read only ever sees frames
 *   of the request that is running. A request that waits on its client (an elicitation answer, a
 *   `roots/list` reply) steps aside with {@link awaitOutsideRequest} so the client can call in. If
 *   two runs of one storage overlap inside the same request (concurrent sibling calls), the storage
 *   stops answering for that request and throws {@link AsyncContextOverlapError} instead of
 *   guessing.
 */
import { AsyncContextOverlapError } from './overlap-error';

export { AsyncContextOverlapError } from './overlap-error';

export type AsyncContextMode = 'native' | 'serialized';

interface NativeVariable<T> {
  run<R>(value: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R;
  get(): T | undefined;
}

interface NativeAsyncContext {
  Variable: new <T>(options?: { name?: string }) => NativeVariable<T>;
}

/** TC39 `AsyncContext`, when the runtime has it. */
const nativeAsyncContext: NativeAsyncContext | undefined = (() => {
  const candidate = (globalThis as { AsyncContext?: { Variable?: unknown } }).AsyncContext;
  return typeof candidate?.Variable === 'function' ? (candidate as NativeAsyncContext) : undefined;
})();

export function getAsyncContextMode(): AsyncContextMode {
  return nativeAsyncContext ? 'native' : 'serialized';
}

/** How long a request may wait for its turn before the storage explains why. */
const SLOW_TURN_WARNING_MS = 10_000;

/** One top-level request (or the root, for code that runs outside any request). */
class RequestSlot {
  /** Frames of every storage that are still running in this request. */
  live = 0;
  /** Storages whose runs overlapped in this request; they refuse to answer until they unwind. */
  readonly tainted = new Set<object>();
  private readonly idleWaiters: Array<() => void> = [];

  enter(): void {
    this.live++;
  }

  leave(): void {
    this.live--;
    if (this.live === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  /** Resolves once no frame of this request is running any more. */
  idle(): Promise<void> {
    return this.live === 0 ? Promise.resolve() : new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }
}

const ROOT = new RequestSlot();

/** The request whose stacks reads use: the one holding the turn, or the root. */
let active: RequestSlot = ROOT;
/** The request holding the turn. */
let owner: RequestSlot | undefined;
const turnQueue: Array<{ slot: RequestSlot; start: () => void }> = [];
let slowTurnWarned = false;
let overlapReported = false;

function takeTurn(slot: RequestSlot): Promise<void> {
  if (!owner) {
    owner = slot;
    active = slot;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (slowTurnWarned) return;
      slowTurnWarned = true;
      console.warn(
        '[frontmcp] A request has waited more than 10s for another one to finish. This runtime has no ' +
          'AsyncContext, so FrontMCP runs requests one at a time to keep their contexts apart. A tool that ' +
          'calls its own server through a client (instead of this.scope flows) waits for itself.',
      );
    }, SLOW_TURN_WARNING_MS);
    (timer as { unref?: () => void }).unref?.();
    turnQueue.push({
      slot,
      start: () => {
        clearTimeout(timer);
        resolve();
      },
    });
  });
}

function passTurn(slot: RequestSlot): void {
  if (owner !== slot) return;
  const next = turnQueue.shift();
  if (next) {
    owner = next.slot;
    active = next.slot;
    next.start();
  } else {
    owner = undefined;
    active = ROOT;
  }
}

/**
 * Run one top-level request. With native `AsyncContext` it only calls `fn`. Without it, the request
 * waits for its turn, runs with its own stacks, and keeps the turn until `fn` settles and every
 * store it opened has unwound, so work it left running cannot read the next request's context.
 */
export async function runRequestExclusive<R>(fn: () => R | Promise<R>): Promise<R> {
  if (nativeAsyncContext) return fn();
  const slot = new RequestSlot();
  await takeTurn(slot);
  try {
    return await fn();
  } finally {
    await slot.idle();
    passTurn(slot);
  }
}

/**
 * Await something the running request waits on from outside, such as its client's answer to an
 * elicitation. Without native `AsyncContext` the request steps aside while it waits, so the client
 * can call the server before answering, and takes its turn back afterwards. Outside a request, or
 * with native `AsyncContext`, it only awaits.
 */
export async function awaitOutsideRequest<T>(promise: PromiseLike<T>): Promise<T> {
  if (nativeAsyncContext) return promise;
  const slot = owner;
  if (!slot || active !== slot) return promise;
  passTurn(slot);
  try {
    return await promise;
  } finally {
    await takeTurn(slot);
  }
}

interface Frame<T> {
  readonly store: T;
}

export class AsyncLocalStorage<T> {
  private readonly native?: NativeVariable<T>;
  private readonly stacks = new WeakMap<RequestSlot, Frame<T>[]>();

  constructor() {
    if (nativeAsyncContext) this.native = new nativeAsyncContext.Variable<T>();
  }

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    if (this.native) return this.native.run(store, callback, ...args);

    const slot = active;
    let stack = this.stacks.get(slot);
    if (!stack) {
      stack = [];
      this.stacks.set(slot, stack);
    }
    const frame: Frame<T> = { store };
    stack.push(frame);
    slot.enter();

    let result: R;
    try {
      result = callback(...args);
    } catch (error) {
      this.leave(slot, frame);
      throw error;
    }
    if (result instanceof Promise) {
      return result.then(
        (value: unknown) => {
          if (!this.leave(slot, frame)) throw this.overlapError();
          return value;
        },
        (error: unknown) => {
          this.leave(slot, frame);
          throw error;
        },
      ) as R;
    }
    this.leave(slot, frame);
    return result;
  }

  getStore(): T | undefined {
    if (this.native) return this.native.get();
    const slot = active;
    if (slot.tainted.has(this)) throw this.overlapError();
    const stack = this.stacks.get(slot);
    return stack && stack.length > 0 ? stack[stack.length - 1].store : undefined;
  }

  /**
   * Remove `frame` from its request's stack. Returns false when it was not the innermost frame: a
   * later run of this storage in the same request was still open, so the two overlapped and reads
   * in between may have seen the other run's store.
   */
  private leave(slot: RequestSlot, frame: Frame<T>): boolean {
    const stack = this.stacks.get(slot) ?? [];
    const index = stack.lastIndexOf(frame);
    const innermost = index === stack.length - 1;
    if (index !== -1) stack.splice(index, 1);
    if (!innermost) {
      slot.tainted.add(this);
      if (!overlapReported) {
        overlapReported = true;
        console.error(
          '[frontmcp] Two concurrent runs of one async context overlapped inside a request. This runtime has ' +
            'no AsyncContext, so the context of each cannot be told apart; reads fail for the rest of that ' +
            'request instead of returning the wrong value.',
        );
      }
    }
    // Once every frame of this storage has unwound, nothing is left to confuse.
    if (stack.length === 0) slot.tainted.delete(this);
    slot.leave();
    return innermost;
  }

  private overlapError(): AsyncContextOverlapError {
    return new AsyncContextOverlapError(
      'Concurrent runs of an async context overlapped in one request, and this runtime has no AsyncContext ' +
        'to tell them apart. Run the calls one after another, or use a runtime with AsyncContext.',
    );
  }
}
