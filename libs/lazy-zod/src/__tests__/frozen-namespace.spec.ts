import { z as realZ } from 'zod';

import { createLazyZ } from '../lazy-z';
import { isLazy } from '../utils';

/**
 * zod 4.6.0 started shipping its `z` namespace `Object.freeze`d — every export
 * became a non-configurable, non-writable DATA property. Proxying that object
 * directly and returning a lazy factory from the `get` trap violates a Proxy
 * invariant and throws at import time, which took down every published package
 * that loads `@frontmcp/lazy-zod`.
 *
 * These specs pin the shape rather than the installed zod, so the guard holds
 * whichever version the repo happens to pin.
 */
describe('createLazyZ over a frozen namespace', () => {
  // A stand-in with the same property shape zod >= 4.6 exposes: frozen, null
  // prototype, plain data properties.
  function makeFrozenNamespace(): typeof realZ {
    const ns = Object.create(null) as Record<string, unknown>;
    ns['object'] = (shape: Record<string, unknown>) => realZ.object(shape as never);
    ns['union'] = (options: unknown[]) => realZ.union(options as never);
    ns['string'] = () => realZ.string();
    ns['number'] = () => realZ.number();
    ns['NEVER'] = realZ.NEVER;
    return Object.freeze(ns) as unknown as typeof realZ;
  }

  it('intercepts a heavy factory without tripping the read-only proxy invariant', () => {
    const ns = makeFrozenNamespace();
    expect(Object.isFrozen(ns)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(ns, 'object')).toMatchObject({
      writable: false,
      configurable: false,
    });

    const z = createLazyZ(ns);

    const schema = z.object({ a: z.string() });
    expect(isLazy(schema)).toBe(true);
    expect(schema.parse({ a: 'hi' })).toEqual({ a: 'hi' });
  });

  it('passes non-heavy members through to the frozen namespace', () => {
    const z = createLazyZ(makeFrozenNamespace());

    expect(isLazy(z.string())).toBe(false);
    expect(z.string().parse('hi')).toBe('hi');
    expect(z.NEVER).toBe(realZ.NEVER);
  });

  it('reports the frozen namespace for has / ownKeys / descriptors', () => {
    const ns = makeFrozenNamespace();
    const z = createLazyZ(ns);

    expect('object' in z).toBe(true);
    expect('nope' in z).toBe(false);
    expect(Object.keys(z).sort()).toEqual(Object.keys(ns).sort());
    // Reported configurable — the empty proxy target owns none of these keys,
    // and reporting them non-configurable is itself an invariant violation.
    expect(Object.getOwnPropertyDescriptor(z, 'object')).toMatchObject({ configurable: true });
    expect(Object.getOwnPropertyDescriptor(z, 'nope')).toBeUndefined();
    expect(Object.getPrototypeOf(z)).toBe(Object.getPrototypeOf(ns));
  });
});

describe('the exported z against the installed zod', () => {
  it('builds a lazy object schema regardless of whether zod freezes its namespace', async () => {
    const { z } = await import('../lazy-z');

    const schema = z.object({ a: z.string(), b: z.number() });
    expect(isLazy(schema)).toBe(true);
    expect(schema.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
  });
});
