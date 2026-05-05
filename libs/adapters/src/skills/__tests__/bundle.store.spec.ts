import {
  BundleStore,
  type BundleStoreCounter,
  type BundleStoreSpan,
  type BundleStoreTelemetry,
} from '../bundle/bundle.store';
import type { ResolvedBundle } from '../bundle/bundle.types';

interface CounterCall {
  by: number;
  attributes: Record<string, string>;
}
interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  events: { name: string; attrs?: Record<string, string | number | boolean> }[];
  ended: boolean;
  endedWithError?: string | undefined;
}

function makeFakeTelemetry(): {
  telemetry: BundleStoreTelemetry;
  counterCalls: Record<string, CounterCall[]>;
  spans: RecordedSpan[];
} {
  const counterCalls: Record<string, CounterCall[]> = {};
  const spans: RecordedSpan[] = [];

  const telemetry: BundleStoreTelemetry = {
    createCounter(name: string): BundleStoreCounter {
      if (!counterCalls[name]) counterCalls[name] = [];
      return {
        inc(by = 1, attributes: Record<string, string> = {}) {
          counterCalls[name].push({ by, attributes });
        },
      };
    },
    startSpan(name, attributes = {}): BundleStoreSpan {
      const span: RecordedSpan = { name, attributes: { ...attributes }, events: [], ended: false };
      spans.push(span);
      return {
        setAttributes(attrs) {
          Object.assign(span.attributes, attrs);
        },
        addEvent(eventName, attrs) {
          span.events.push({ name: eventName, attrs });
        },
        recordError(err) {
          span.endedWithError = err.message;
        },
        end() {
          span.ended = true;
        },
        endWithError(err) {
          span.ended = true;
          span.endedWithError = typeof err === 'string' ? err : err.message;
        },
      };
    },
  };
  return { telemetry, counterCalls, spans };
}

const baseBundle = (version = '1'): ResolvedBundle => ({
  schemaVersion: 1,
  bundleId: 'acme:prod',
  version,
  generatedAt: '2026-05-01T12:00:00.000Z',
  sourceDigest: 'c'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' } },
  skills: [{ id: 's', name: 'S', description: 'd', instructions: 'i', operationIds: [] }],
  operations: {},
});

describe('BundleStore', () => {
  it('starts empty', () => {
    const store = new BundleStore();
    expect(store.current()).toBeUndefined();
  });

  it('swaps to the new bundle and exposes it via current()', () => {
    const store = new BundleStore();
    const b = baseBundle();
    store.swap(b);
    expect(store.current()).toBe(b);
  });

  it('returns a structured diff on swap', () => {
    const store = new BundleStore();
    const a = baseBundle('1');
    const b = baseBundle('2');
    store.swap(a);
    const diff = store.swap(b);
    expect(diff.isNoOp).toBe(false);
  });

  it('fires listeners with previous + current + diff', () => {
    const store = new BundleStore();
    const events: { prevVersion?: string; currVersion: string; isNoOp: boolean }[] = [];
    store.subscribe((e) => {
      events.push({
        prevVersion: e.previous?.version,
        currVersion: e.current.version,
        isNoOp: e.diff.isNoOp,
      });
    });

    store.swap(baseBundle('1'));
    store.swap(baseBundle('2'));

    expect(events).toEqual([
      { prevVersion: undefined, currVersion: '1', isNoOp: false },
      { prevVersion: '1', currVersion: '2', isNoOp: false },
    ]);
  });

  it('listener errors do not poison the swap', () => {
    const store = new BundleStore();
    store.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => store.swap(baseBundle())).not.toThrow();
    expect(store.current()).toBeDefined();
  });

  it('unsubscribe stops further notifications', () => {
    const store = new BundleStore();
    const fn = jest.fn();
    const unsub = store.subscribe(fn);
    store.swap(baseBundle('1'));
    unsub();
    store.swap(baseBundle('2'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws on swap with falsy bundle', () => {
    const store = new BundleStore();
    expect(() => store.swap(undefined as unknown as ResolvedBundle)).toThrow();
  });

  it('reset() clears state', () => {
    const store = new BundleStore();
    store.swap(baseBundle());
    store.reset();
    expect(store.current()).toBeUndefined();
  });

  describe('versioning + rollback', () => {
    it('rejects historySize < 1', () => {
      expect(() => new BundleStore({ historySize: 0 })).toThrow();
      expect(() => new BundleStore({ historySize: -1 })).toThrow();
      expect(() => new BundleStore({ historySize: 1.5 })).toThrow();
    });

    it('records the prior bundle in history on each successful swap', () => {
      const store = new BundleStore({ historySize: 3 });
      store.swap(baseBundle('1'));
      store.swap(baseBundle('2'));
      store.swap(baseBundle('3'));
      const snap = store.historySnapshot();
      expect(snap.map((h) => h.version)).toEqual(['1', '2']);
    });

    it('caps history at historySize and evicts oldest first', () => {
      const store = new BundleStore({ historySize: 2 });
      for (const v of ['1', '2', '3', '4']) store.swap(baseBundle(v));
      const snap = store.historySnapshot();
      expect(snap.map((h) => h.version)).toEqual(['2', '3']);
    });

    it('pin(version) re-activates a known historical bundle and emits reason=pin', () => {
      const store = new BundleStore({ historySize: 3 });
      const events: string[] = [];
      store.subscribe((e) => events.push(`${e.current.version}:${e.reason}`));
      store.swap(baseBundle('1'));
      store.swap(baseBundle('2'));
      store.swap(baseBundle('3'));
      store.pin('1');
      expect(store.current()?.version).toBe('1');
      expect(store.isPinned()).toBe(true);
      expect(store.pinned()).toBe('1');
      expect(events).toContain('1:pin');
    });

    it('pin(currentVersion) marks pinned without re-emitting', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      const fn = jest.fn();
      store.subscribe(fn);
      store.pin('1');
      expect(store.isPinned()).toBe(true);
      expect(fn).not.toHaveBeenCalled();
    });

    it('pin(unknownVersion) throws', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      expect(() => store.pin('does-not-exist')).toThrow(/not in history/);
    });

    it('swap() throws BundlePinnedError while pinned', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      store.swap(baseBundle('2'));
      store.pin('1');
      expect(() => store.swap(baseBundle('3'))).toThrow(/pinned/);
    });

    it('unpin() lets swap() resume', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      store.swap(baseBundle('2'));
      store.pin('1');
      store.unpin();
      expect(store.isPinned()).toBe(false);
      store.swap(baseBundle('3'));
      expect(store.current()?.version).toBe('3');
    });

    it('rollback() activates the most recent prior bundle and clears the pin', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      store.swap(baseBundle('2'));
      store.pin('2');
      store.rollback();
      expect(store.current()?.version).toBe('1');
      expect(store.isPinned()).toBe(false);
    });

    it('rollback() throws when no prior bundle exists', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      expect(() => store.rollback()).toThrow(/no prior bundle/);
    });

    it('historySnapshot() returns a copy that does not leak internal state', () => {
      const store = new BundleStore();
      store.swap(baseBundle('1'));
      store.swap(baseBundle('2'));
      const snap = store.historySnapshot();
      snap.push({ version: 'fake', bundleId: 'x', validatedAt: 0 });
      expect(store.historySnapshot()).toHaveLength(1);
    });
  });

  describe('telemetry', () => {
    it('does nothing when telemetry is not provided', () => {
      const store = new BundleStore();
      expect(() => store.swap(baseBundle('1'))).not.toThrow();
    });

    it('increments the bundle-pulls counter on a successful swap', () => {
      const { telemetry, counterCalls, spans } = makeFakeTelemetry();
      const store = new BundleStore({ telemetry });
      store.swap(baseBundle('1'), 'npm');
      expect(counterCalls['frontmcp_skills_bundle_pulls_total']).toEqual([
        { by: 1, attributes: { status: 'ok', source: 'npm' } },
      ]);
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('skill.bundle.swap');
      expect(spans[0].attributes['source']).toBe('npm');
      expect(spans[0].attributes['bundle_id']).toBe('acme:prod');
      expect(spans[0].attributes['version']).toBe('1');
      expect(spans[0].attributes['status']).toBe('ok');
      expect(spans[0].ended).toBe(true);
    });

    it('reports source=unknown when no source is given', () => {
      const { telemetry, counterCalls } = makeFakeTelemetry();
      const store = new BundleStore({ telemetry });
      store.swap(baseBundle('1'));
      expect(counterCalls['frontmcp_skills_bundle_pulls_total'][0].attributes['source']).toBe('unknown');
    });

    it('records from_version on subsequent swaps', () => {
      const { telemetry, spans } = makeFakeTelemetry();
      const store = new BundleStore({ telemetry });
      store.swap(baseBundle('1'), 'npm');
      store.swap(baseBundle('2'), 'npm');
      expect(spans).toHaveLength(2);
      expect(spans[1].attributes['from_version']).toBe('1');
    });

    it('increments error counter and records span error when swap throws', () => {
      const { telemetry, counterCalls, spans } = makeFakeTelemetry();
      const store = new BundleStore({ telemetry });
      store.swap(baseBundle('1'), 'npm');
      store.swap(baseBundle('2'), 'npm');
      store.pin('1');
      // Pinned — next swap throws BundlePinnedError
      expect(() => store.swap(baseBundle('3'), 'saas-pull')).toThrow(/pinned/);

      const errorCalls = counterCalls['frontmcp_skills_bundle_pulls_total'].filter(
        (c) => c.attributes['status'] === 'error',
      );
      expect(errorCalls).toHaveLength(1);
      // `saas-pull` is in the bounded source vocabulary so it passes through.
      expect(errorCalls[0].attributes['source']).toBe('saas-pull');
      // Reason is now classified to a bounded vocabulary instead of echoing
      // the raw Error.name (which is untrusted user input on the failure path).
      expect(errorCalls[0].attributes['reason']).toBe('pinned');

      // Span recorded the error and was ended.
      const errorSpan = spans[spans.length - 1];
      expect(errorSpan.ended).toBe(true);
      expect(errorSpan.endedWithError).toMatch(/pinned/);
    });

    it('coerces unknown source values to `unknown` (cardinality bound)', () => {
      const { telemetry, counterCalls, spans } = makeFakeTelemetry();
      const store = new BundleStore({ telemetry });
      // A URL or tenant ID would otherwise spawn one timeseries per value.
      store.swap(baseBundle('1'), 'https://malicious.example.com/path?id=42');
      const calls = counterCalls['frontmcp_skills_bundle_pulls_total'];
      expect(calls).toHaveLength(1);
      expect(calls[0].attributes['source']).toBe('unknown');
      expect(spans[0].attributes['source']).toBe('unknown');
    });

    it('records exception only once via endWithError (no double recording)', () => {
      // Track every `recordError` invocation in addition to the existing fields
      // so we can assert that the swap path does NOT call both recordError AND
      // endWithError on the same span.
      const recordedErrors: string[] = [];
      interface SpanWithRecord {
        recordError?: (e: Error) => void;
      }
      const telemetry = {
        createCounter() {
          return { inc: () => undefined };
        },
        startSpan() {
          let endedWithError: string | undefined;
          let ended = false;
          const span = {
            setAttributes: () => undefined,
            addEvent: () => undefined,
            end: () => {
              ended = true;
            },
            endWithError: (err: Error | string) => {
              ended = true;
              endedWithError = typeof err === 'string' ? err : err.message;
            },
            recordError: (err: Error) => {
              recordedErrors.push(err.message);
            },
            // Expose flags on the returned span object so the test can read them.
            get ended() {
              return ended;
            },
            get endedWithError() {
              return endedWithError;
            },
          };
          return span as unknown as SpanWithRecord & {
            setAttributes: () => void;
            addEvent: () => void;
            end: () => void;
            endWithError: (err: Error | string) => void;
          };
        },
      };
      const store = new BundleStore({ telemetry });
      store.swap(baseBundle('1'), 'npm');
      store.swap(baseBundle('2'), 'npm');
      store.pin('1');
      expect(() => store.swap(baseBundle('3'), 'npm')).toThrow(/pinned/);
      // Only `endWithError` should have run — `recordError` is the alternate
      // path used only when `endWithError` isn't available on the span.
      expect(recordedErrors).toHaveLength(0);
    });

    it('records skill_count attribute from the new bundle', () => {
      const { telemetry, spans } = makeFakeTelemetry();
      const store = new BundleStore({ telemetry });
      const bundle = baseBundle('1');
      bundle.skills = [
        { id: 'a', name: 'A', description: 'a', instructions: 'a', operationIds: [] },
        { id: 'b', name: 'B', description: 'b', instructions: 'b', operationIds: [] },
      ];
      store.swap(bundle, 'static');
      expect(spans[0].attributes['skill_count']).toBe(2);
    });
  });
});
