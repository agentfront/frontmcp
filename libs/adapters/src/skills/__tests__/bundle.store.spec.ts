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
});
