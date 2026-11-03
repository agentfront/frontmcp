import { StoreNotOpenedInBuildError } from '../errors/build-store.errors';

/** The factories of the providers made with {@link storeProvider}. */
const storeFactories = new WeakSet<object>();

/** Read without a call by what probes an instance: promises, JSON, lifecycle hooks (`onBootstrap()` and the like). */
function isProbe(property: string): boolean {
  return property === 'then' || property === 'toJSON' || property.startsWith('on');
}

/**
 * Mark a factory provider as one that opens a store: a Redis client, a SQLite file, a remote service. A build boots the
 * server only to read it, and opens no store (#1041): there the factory does not run, and what injects the provider
 * gets a stand-in whose every call throws `StoreNotOpenedInBuildError`. Any other boot builds it as usual.
 */
export function storeProvider<Provider extends { useFactory: (...args: never[]) => unknown }>(
  provider: Provider,
): Provider {
  storeFactories.add(provider.useFactory);
  return provider;
}

/** Whether a provider's factory opens a store: see {@link storeProvider}. */
export function opensStore(factory: unknown): boolean {
  return typeof factory === 'function' && storeFactories.has(factory);
}

/** What a build gets in place of the store `name`, which it does not open. */
export function storeNotOpened(name: string): object {
  return new Proxy(
    {},
    {
      get: (target, property, receiver) =>
        typeof property === 'symbol' || isProbe(property) || property in target
          ? Reflect.get(target, property, receiver)
          : () => {
              throw new StoreNotOpenedInBuildError(name);
            },
    },
  );
}
