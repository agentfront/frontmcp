import { BundleStore } from '../bundle/bundle.store';
import type { ResolvedBundle } from '../bundle/bundle.types';

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
});
