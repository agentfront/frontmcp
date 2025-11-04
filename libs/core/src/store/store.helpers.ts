import type { AllPrefixes, KeysFor, PrefixStore, SetOptions, ValueFor } from './store.types';
import { getRegistryForScope } from './store.registry';
import { buildChannel, buildDataKey, Json } from './store.utils';
import { Scope } from '../scope/scope.instance';

export function useStore(scope: Scope, storeName: string) {
  const registry = getRegistryForScope(scope.id);
  const driver = registry.ensure(storeName);

  return function forPrefix<P extends AllPrefixes>(prefix: P): PrefixStore<P> {
    return {
      scope,
      prefix,
      storeName,

      async get<K extends KeysFor<P>>(key: K) {
        const raw = await driver.get(buildDataKey(scope, prefix, String(key)));
        return Json.decode<ValueFor<P, K>>(raw);
      },
      async set<K extends KeysFor<P>>(key: K, value: ValueFor<P, K>, opts?: SetOptions) {
        await driver.set(buildDataKey(scope, prefix, String(key)), Json.encode(value), opts);
      },
      async del<K extends KeysFor<P>>(key: K) {
        await driver.del(buildDataKey(scope, prefix, String(key)));
      },
      async exists<K extends KeysFor<P>>(key: K) {
        return driver.exists(buildDataKey(scope, prefix, String(key)));
      },
      async incr<K extends KeysFor<P>>(key: K) {
        return driver.incr(buildDataKey(scope, prefix, String(key)));
      },
      async decr<K extends KeysFor<P>>(key: K) {
        return driver.decr(buildDataKey(scope, prefix, String(key)));
      },
      async expire<K extends KeysFor<P>>(key: K, ttlSeconds: number) {
        await driver.expire(buildDataKey(scope, prefix, String(key)), ttlSeconds);
      },
      async ttl<K extends KeysFor<P>>(key: K) {
        return driver.ttl(buildDataKey(scope, prefix, String(key)));
      },
      async publish(channel: string, message: string) {
        return driver.publish(buildChannel(scope, prefix, channel), message);
      },
      async subscribe(channel: string, handler: (message: string) => void) {
        const ch = buildChannel(scope, prefix, channel);
        return driver.subscribe(ch, handler);
      },
    } satisfies PrefixStore<P>;
  };
}

// Batch helpers bound to a store name
export async function setMany<P extends AllPrefixes, K extends KeysFor<P>>(
  scope: Scope,
  storeName: string,
  prefix: P,
  entries: Array<{ key: K; value: ValueFor<P, K>; opts?: SetOptions }>,
): Promise<void> {
  const { ensure } = getRegistryForScope(scope.id);
  const driver = ensure(storeName);
  await driver.mset(
    entries.map((e) => ({
      key: buildDataKey(scope, prefix, String(e.key)),
      value: Json.encode(e.value),
      opts: e.opts,
    })),
  );
}

export async function getMany<P extends AllPrefixes, K extends KeysFor<P>, V = ValueFor<P, K>>(
  scope: Scope,
  storeName: string,
  prefix: P,
  keys: K[],
): Promise<Array<V | null>> {
  const driver = getRegistryForScope(scope.id).ensure(storeName);
  const fullKeys = keys.map((k) => buildDataKey(scope, prefix, String(k)));
  const res = await driver.mget(fullKeys);
  return res.map((r) => Json.decode<V>(r));
}
