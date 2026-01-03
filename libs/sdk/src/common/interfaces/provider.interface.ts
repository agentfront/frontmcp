import { Type, Token, ValueType, ClassType, FactoryType, ClassToken } from '@frontmcp/di';
import { ProviderMetadata } from '../metadata';

export interface ProviderInterface {}

export type ProviderClassType<Provide> = ClassType<Provide> & ProviderMetadata;
export type ProviderValueType<Provide> = ValueType<Provide> & ProviderMetadata;
export type ProviderFactoryType<Provide, Tokens extends readonly (ClassToken | Token)[]> = FactoryType<
  Provide,
  Tokens
> &
  ProviderMetadata;

export type ProviderType<
  Provide extends ProviderInterface = any,
  Tokens extends readonly (ClassToken | Token)[] = readonly (ClassToken | Token)[],
> = Type<Provide> | ProviderClassType<Provide> | ProviderValueType<Provide> | ProviderFactoryType<Provide, Tokens>;

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
