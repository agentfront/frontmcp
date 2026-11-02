/**
 * The observer chain a request's hooks run through: every installed observer wraps the hook, in install order, an
 * observer that fails never breaks the hook, and the dev trace is recorded by one of them.
 */
import 'reflect-metadata';

import { AsyncLocalStorage } from '@frontmcp/utils';

import { FlowControl } from '../../common';
import {
  addHookObserver,
  HOOK_OBSERVER_KEY,
  HOOK_TRACE_META_KEY,
  observersOf,
  recordHookTrace,
  runObservedHook,
  withHookTrace,
  type HookObserver,
  type HookTraceEntry,
  type ObservedHook,
} from '../hook-observers';

const hook: ObservedHook = {
  flowName: 'tools:call-tool',
  stage: 'willExecute',
  type: 'will',
  owner: 'setup-gate',
  method: 'requireSetup',
  target: {},
  flowContext: {},
};

function contextStore() {
  const values = new Map<symbol, unknown>();
  return { get: (key: symbol) => values.get(key), set: (key: symbol, value: unknown) => void values.set(key, value) };
}

function wrapping(name: string, log: string[]): HookObserver {
  return async (_hook, run) => {
    log.push(`${name}:before`);
    await run();
    log.push(`${name}:after`);
  };
}

describe('runObservedHook', () => {
  it('runs the hook inside every observer, the first installed outermost', async () => {
    const log: string[] = [];

    await runObservedHook([wrapping('a', log), wrapping('b', log)], hook, async () => void log.push('hook'));

    expect(log).toEqual(['a:before', 'b:before', 'hook', 'b:after', 'a:after']);
  });

  it('runs the hook once when an observer throws before running it, and reports the throw', async () => {
    const log: string[] = [];
    const broken = new Error('span exporter down');
    const reported: unknown[] = [];
    const failing: HookObserver = async () => {
      throw broken;
    };

    await runObservedHook(
      [failing, wrapping('b', log)],
      hook,
      async () => void log.push('hook'),
      (error) => reported.push(error),
    );

    expect(log).toEqual(['b:before', 'hook', 'b:after']);
    expect(reported).toEqual([broken]);
  });

  it('keeps the hook outcome when an observer throws after running it', async () => {
    const reported: unknown[] = [];
    const failingAfter: HookObserver = async (_hook, run) => {
      await run();
      throw new Error('could not end the span');
    };

    await expect(
      runObservedHook(
        [failingAfter],
        hook,
        async () => undefined,
        (error) => reported.push(error),
      ),
    ).resolves.toBeUndefined();
    expect(reported).toHaveLength(1);
  });

  it("passes the hook's own failure on, even when an observer swallows it", async () => {
    const refused = new FlowControl('respond', { content: [] });
    const swallowing: HookObserver = async (_hook, run) => {
      await run().catch(() => undefined);
    };
    const reported = jest.fn();

    await expect(
      runObservedHook(
        [swallowing],
        hook,
        async () => {
          throw refused;
        },
        reported,
      ),
    ).rejects.toBe(refused);
    expect(reported).not.toHaveBeenCalled();
  });

  it("passes the hook's own failure on unchanged, and reports only what the observer threw in its place", async () => {
    const hookFailure = new Error('ledger locked');
    const wrapped = new Error('wrapped by the observer');
    const rethrowingAnother: HookObserver = async (_hook, run) => {
      await run().catch(() => {
        throw wrapped;
      });
    };
    const reported: unknown[] = [];

    await expect(
      runObservedHook(
        [rethrowingAnother, wrapping('inner', [])],
        hook,
        async () => {
          throw hookFailure;
        },
        (error) => reported.push(error),
      ),
    ).rejects.toBe(hookFailure);
    expect(reported).toEqual([wrapped]);
  });

  it('runs the hook once, in the request context, when an observer calls run after an await or after it settled', async () => {
    const request = new AsyncLocalStorage<string>();
    const seen: Array<string | undefined> = [];
    const late: HookObserver = async (_hook, run) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await run();
    };
    const afterSettling: HookObserver = async (_hook, run) => {
      setTimeout(() => void run(), 1);
    };

    await request.run('request-1', () =>
      runObservedHook([late, afterSettling], hook, async () => void seen.push(request.getStore())),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(seen).toEqual(['request-1']);
  });

  it('runs the hook once when an observer never calls run, or calls it twice', async () => {
    let runs = 0;
    const skipping: HookObserver = async () => undefined;
    const twice: HookObserver = async (_hook, run) => {
      await run();
      await run();
    };

    await runObservedHook([skipping, twice], hook, async () => void runs++);

    expect(runs).toBe(1);
  });
});

describe('the observers of a request', () => {
  it('lists the observers added to the request, in the order they were added, each once', () => {
    const context = contextStore();
    const first: HookObserver = async (_hook, run) => run();
    const second: HookObserver = async (_hook, run) => run();

    addHookObserver(context, first);
    addHookObserver(context, second);
    addHookObserver(context, first);

    expect(observersOf(context)).toEqual([first, second]);
  });

  it('reads a single observer set under the key directly, as an older @frontmcp/observability does', () => {
    const context = contextStore();
    const legacy: HookObserver = async (_hook, run) => run();
    context.set(HOOK_OBSERVER_KEY, legacy);

    addHookObserver(context, wrapping('next', []));

    expect(observersOf(context)).toEqual([legacy, expect.any(Function)]);
  });

  it('has none when nothing was installed', () => {
    expect(observersOf(contextStore())).toEqual([]);
  });
});

describe('the dev hook trace', () => {
  it('records each hook it wraps, in the order the hooks start, with no arguments or answers', async () => {
    const trace: HookTraceEntry[] = [];
    const record = recordHookTrace(trace);
    const around: ObservedHook = { ...hook, stage: 'aroundExecute', type: 'around', owner: 'Timer', method: 'time' };

    await runObservedHook([record], around, () =>
      runObservedHook([record], { ...hook, stage: 'execute', type: 'stage' }, async () => undefined),
    );
    await runObservedHook([record], { ...hook, stage: 'didValidateOutput', type: 'did' }, async () => {
      FlowControl.respond({ content: [] });
    }).catch(() => undefined);
    await runObservedHook([record], { ...hook, stage: 'finallyFinalize', type: 'finally' }, async () => {
      throw new Error('store down');
    }).catch(() => undefined);

    expect(trace).toEqual([
      { owner: 'Timer', method: 'time', stage: 'execute', type: 'around', ms: expect.any(Number), outcome: 'ok' },
      {
        owner: 'setup-gate',
        method: 'requireSetup',
        stage: 'execute',
        type: 'stage',
        ms: expect.any(Number),
        outcome: 'ok',
      },
      {
        owner: 'setup-gate',
        method: 'requireSetup',
        stage: 'validateOutput',
        type: 'did',
        ms: expect.any(Number),
        outcome: 'respond',
      },
      {
        owner: 'setup-gate',
        method: 'requireSetup',
        stage: 'finalize',
        type: 'finally',
        ms: expect.any(Number),
        outcome: 'error',
      },
    ]);
    expect(trace.every((entry) => entry.ms >= 0)).toBe(true);
  });

  it("adds the trace to an answer's _meta, keeping what it holds, without changing the answer it was given", () => {
    const answer = { content: [], _meta: { 'frontmcp/budget': { maxBytes: 10 } } };
    const trace: HookTraceEntry[] = [
      { owner: 'setup-gate', method: 'requireSetup', stage: 'execute', type: 'will', ms: 0.2, outcome: 'ok' },
    ];

    expect(withHookTrace(answer, trace)).toEqual({
      content: [],
      _meta: { 'frontmcp/budget': { maxBytes: 10 }, [HOOK_TRACE_META_KEY]: trace },
    });
    expect(answer._meta).toEqual({ 'frontmcp/budget': { maxBytes: 10 } });
    expect(HOOK_TRACE_META_KEY).toBe('frontmcp/trace');
  });

  it('leaves an answer that is not an object as it is', () => {
    expect(withHookTrace(undefined, [])).toBeUndefined();
  });
});
