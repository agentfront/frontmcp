import { z } from 'zod';
import { FlowName } from '../../metadata';

export type Dict = Record<PropertyKey, unknown>;
type RequiredView<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };
type StateAccess<T> = { [K in keyof T]: T[K] | undefined } & { required: RequiredView<T> };

type StateType<Name extends FlowName> = z.infer<ExtendFlows[Name]['state']>

export type FlowStateOf<Name extends FlowName, T = StateType<Name>> = StateAccess<T> & {
  get<K extends keyof T>(key: K): T[K] | undefined;
  getOrThrow<K extends keyof T>(key: K, message?: string): Exclude<T[K], undefined>;
  set<K extends keyof T>(key: K, value: T[K]): FlowStateOf<Name, T>;
  set(patch: Partial<T>): FlowStateOf<Name, T>;
  snapshot(): Readonly<Partial<T>>;
};

export class FlowState {
  private constructor() {
    /* empty */
  }

  static create<Name extends FlowName, T = StateType<Name>>(initial?: Partial<T>): FlowStateOf<Name> {
    const data: Partial<T> = initial ? { ...initial } : {};

    const api = {
      get<K extends keyof T>(key: K) {
        return data[key] as T[K] | undefined;
      },
      getOrThrow<K extends keyof T>(key: K, message?: string) {
        const val = data[key];
        if (val === undefined || val === null) {
          throw new Error(message ?? `InvokeState: missing required key "${String(key)}"`);
        }
        return val as Exclude<T[K], undefined>;
      },
      set<K extends keyof T>(...args: [K, T[K]] | [Partial<T>]) {
        if (args.length === 1) Object.assign(data, args[0]);
        else {
          const [k, v] = args as [K, T[K]];
          (data as any)[k] = v;
        }
        return proxy as FlowStateOf<Name>;
      },
      snapshot() {
        return { ...data } as Readonly<Partial<T>>;
      },
    };

    const requiredProxy = new Proxy({} as RequiredView<T>, {
      get(_t, prop: PropertyKey) {
        const val = (data as any)[prop];
        if (val === undefined || val === null) {
          throw new Error(`InvokeState: missing required key "${String(prop)}"`);
        }
        return val;
      },
      has(_t, prop) {
        const val = (data as any)[prop];
        return val !== undefined && val !== null;
      },
      ownKeys() {
        return Reflect.ownKeys(data as object);
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      },
    });

    const methodKeys = new Set<PropertyKey>(['get', 'getOrThrow', 'set', 'snapshot']);

    const proxy = new Proxy(api as any, {
      get(_t, prop: PropertyKey, receiver) {
        if (prop === 'required') return requiredProxy;
        if (methodKeys.has(prop)) return Reflect.get(api as any, prop, receiver);
        return (data as any)[prop];
      },
      set(_t, prop: PropertyKey, value) {
        (data as any)[prop] = value;
        return true;
      },
      has(_t, prop) {
        return prop === 'required' || methodKeys.has(prop) || prop in (data as object);
      },
      ownKeys() {
        return [...Reflect.ownKeys(data as object), 'required', ...methodKeys] as ArrayLike<string | symbol>;
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (prop === 'required' || methodKeys.has(prop)) {
          return { enumerable: false, configurable: true };
        }
        return { enumerable: true, configurable: true };
      },
    });

    return proxy as FlowStateOf<Name>;
  }
}
