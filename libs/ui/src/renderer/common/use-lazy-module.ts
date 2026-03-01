import { useState, useEffect } from 'react';
import type { LazyImport } from './lazy-import';

/**
 * React hook that loads a lazy module and triggers a re-render when it finishes.
 *
 * Without this hook, components that call `lazyX.get()` synchronously will render
 * once (returning undefined), show a "Loading..." fallback, and never re-render
 * because nothing triggers an update when the module finishes loading.
 *
 * @param lazy - A lazy import handle created by `createLazyImport`.
 * @returns The loaded module, or `undefined` while still loading.
 */
export function useLazyModule<T>(lazy: LazyImport<T>): T | undefined {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (lazy.getState().status === 'loaded') return;
    lazy.load().then(
      () => forceUpdate((n) => n + 1),
      () => forceUpdate((n) => n + 1),
    );
  }, [lazy]);

  return lazy.get();
}
