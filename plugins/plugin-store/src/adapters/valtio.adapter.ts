import { proxy, snapshot, subscribe } from 'valtio/vanilla';
import type { StoreAdapter } from '../store.types';

function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Get a nested value from an object using a path array.
 * Supports array index notation: `[0]`, `[1]`, etc.
 */
function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    // Array index notation: [0], [1], etc.
    const arrayMatch = segment.match(/^\[(\d+)]$/);
    if (arrayMatch) {
      const index = parseInt(arrayMatch[1], 10);
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      if (!isSafeKey(segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

/**
 * Set a nested value on a mutable object using a path array.
 * Creates intermediate objects as needed.
 * Supports array index notation: `[0]`, `[1]`, etc.
 */
function setNestedValue(obj: unknown, path: string[], value: unknown): void {
  if (path.length === 0) return;

  let current: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const arrayMatch = segment.match(/^\[(\d+)]$/);
    if (arrayMatch) {
      const index = parseInt(arrayMatch[1], 10);
      if (Array.isArray(current)) {
        if (current[index] === undefined || current[index] === null) {
          (current as unknown as unknown[])[index] = {};
        }
        current = (current as unknown as unknown[])[index] as Record<string, unknown>;
      }
    } else {
      if (!isSafeKey(segment)) return;
      if (current[segment] === undefined || current[segment] === null) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
  }

  const lastSegment = path[path.length - 1];
  const lastArrayMatch = lastSegment.match(/^\[(\d+)]$/);
  if (lastArrayMatch) {
    const index = parseInt(lastArrayMatch[1], 10);
    if (Array.isArray(current)) {
      (current as unknown as unknown[])[index] = value;
    }
  } else {
    if (!isSafeKey(lastSegment)) return;
    current[lastSegment] = value;
  }
}

/**
 * Create a Valtio-backed store adapter.
 *
 * @example
 * ```typescript
 * const counterStore = createValtioStore({ count: 0, history: [] as number[] });
 * counterStore.setState(['count'], 1);
 * console.log(counterStore.getState(['count'])); // 1
 * ```
 */
export function createValtioStore<T extends object>(initialState: T): StoreAdapter<T> {
  const state = proxy(initialState);

  return {
    getState: ((path?: string[]) => {
      const snap = snapshot(state) as T;
      if (!path || path.length === 0) return snap;
      return getNestedValue(snap, path);
    }) as StoreAdapter<T>['getState'],
    setState(path: string[], value: unknown) {
      if (path.length === 0) {
        // Replace root — copy all keys
        const val = value as Record<string, unknown>;
        for (const key of Object.keys(state)) {
          delete (state as Record<string, unknown>)[key];
        }
        Object.assign(state, val);
      } else {
        setNestedValue(state, path, value);
      }
    },
    subscribe(listener: () => void) {
      return subscribe(state, listener);
    },
    dispose() {
      /* no-op for valtio */
    },
  };
}
