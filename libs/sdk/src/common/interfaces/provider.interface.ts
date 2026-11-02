import { type ClassToken, type ClassType, type FactoryType, type Token, type Type, type ValueType } from '@frontmcp/di';

import { type ProviderMetadata } from '../metadata';

export type ProviderClassType<Provide> = ClassType<Provide> & ProviderMetadata;
export type ProviderValueType<Provide> = ValueType<Provide> & ProviderMetadata;
/** A factory provider; without `inject`, the factory receives no dependencies. */
export type ProviderFactoryType<Provide, Tokens extends readonly (ClassToken | Token)[]> = Omit<
  FactoryType<Provide, Tokens>,
  'inject'
> &
  Partial<Pick<FactoryType<Provide, Tokens>, 'inject'>> &
  ProviderMetadata;

export type ProviderType<
  Provide = unknown,
  Tokens extends readonly (ClassToken | Token)[] = readonly (ClassToken | Token)[],
> = Type<Provide> | ProviderClassType<Provide> | ProviderValueType<Provide> | ProviderFactoryType<Provide, Tokens>;

/** A GLOBAL provider whose `onBootstrap()` runs once it is built, after its dependencies and before the server lists anything. */
export interface OnBootstrap {
  onBootstrap(): void | Promise<void>;
}

/** A GLOBAL provider whose `onReady()` runs once the server serves on its transport. */
export interface OnReady {
  onReady(): void | Promise<void>;
}

/** A GLOBAL provider whose `onShutdown()` runs at shutdown, after its dependents', within `lifecycle.shutdownHookTimeoutMs`. */
export interface OnShutdown {
  onShutdown(): void | Promise<void>;
}

/**
 * Helper to define factory providers without tuple widening.
 * Enforces that `useFactory` params follow the `inject()` tokens (order + arity).
 *
 * Usage:
 *   const p = AsyncMcpProvider({
 *     provide: RedisProviderRef,
 *     inject: () => [ExpenseConfigRef, RedisType] as const,
 *     useFactory: async (config, redis) => new RedisProvider(redis),
 *   });
 */
export function AsyncProvider<Provide, const Tokens extends readonly (ClassToken | Token)[]>(
  cfg: ProviderFactoryType<Provide, Tokens>,
): ProviderFactoryType<Provide, Tokens> {
  return cfg;
}
