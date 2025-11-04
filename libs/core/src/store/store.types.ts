// ──────────────────────────────────────────────────────────────────────────────
// File: store/store.types.ts
// Purpose: Shared & extendable types for the storage factory
// Model: Each *scope* owns its own StoreRegistry (no global map in the lib).
// Host app provides a registry locator (scope -> registry) via configuration.
// API: useStore(scope, storeName) => (prefix) => PrefixedStore
// Extendability via declaration merging: `interface McpKVNamespaces {}`
// ──────────────────────────────────────────────────────────────────────────────

import { Scope } from '../scope/scope.instance';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  [k: string]: JsonValue;
}

export type JsonArray = Array<JsonValue>;


export interface SetOptions {
  ttlSeconds?: number;
}

export interface StoreDriver {
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  get(key: string): Promise<string | null>;

  set(key: string, value: string, opts?: SetOptions): Promise<void>;

  del(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  mget(keys: string[]): Promise<(string | null)[]>;

  mset(entries: Array<{ key: string; value: string; opts?: SetOptions }>): Promise<void>;

  incr(key: string): Promise<number>;

  decr(key: string): Promise<number>;

  expire(key: string, ttlSeconds: number): Promise<void>;

  ttl(key: string): Promise<number | null>;

  publish(channel: string, message: string): Promise<number>;

  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
}

// A per-scope registry holds multiple named drivers (memory/redis/etc.)
export interface StoreRegistryInterface {
  register(name: string, driver: StoreDriver): void;

  get(name: string): StoreDriver | undefined;

  ensure(name: string): StoreDriver;

  has(name: string): boolean;

  list(): string[];
}

// Typed store interface returned by useStore(scope, name)(prefix)
export interface PrefixStore<P extends AllPrefixes = string> {
  readonly scope: Scope;
  readonly prefix: P;
  readonly storeName: string;

  get<K extends KeysFor<P>>(key: K): Promise<ValueFor<P, K> | null>;

  set<K extends KeysFor<P>>(key: K, value: ValueFor<P, K>, opts?: SetOptions): Promise<void>;

  del<K extends KeysFor<P>>(key: K): Promise<void>;

  exists<K extends KeysFor<P>>(key: K): Promise<boolean>;

  incr<K extends KeysFor<P>>(key: K): Promise<number>;

  decr<K extends KeysFor<P>>(key: K): Promise<number>;

  expire<K extends KeysFor<P>>(key: K, ttlSeconds: number): Promise<void>;

  ttl<K extends KeysFor<P>>(key: K): Promise<number | null>;

  publish(channel: string, message: string): Promise<number>;

  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
}

declare global {
  // Extendable typings via declaration merging
  export interface McpKVNamespaces {
    [scope: string]: {
      [storeName: string]: {
        [key: string]: unknown;
      };
    };
  }
}

export type AllPrefixes = keyof McpKVNamespaces extends never ? string : Extract<keyof McpKVNamespaces, string>;

export type KeysFor<P> = P extends keyof McpKVNamespaces ? Extract<keyof McpKVNamespaces[P], string> : string;

export type ValueFor<P, K> = P extends keyof McpKVNamespaces
  ? K extends keyof McpKVNamespaces[P]
    ? McpKVNamespaces[P][K]
    : unknown
  : unknown;
