import { Type, Token, ClassType, ValueType, FactoryType, ClassToken } from '@frontmcp/di';
import { AuthProviderMetadata } from '../metadata';

export interface AuthProviderInterface {
  headers(): Record<string, string>;

  refreshToken?(): Promise<string | undefined>;
}

export type AuthProviderClassType<Provide> = ClassType<Provide> & AuthProviderMetadata;
export type AuthProviderValueType<Provide> = ValueType<Provide> & AuthProviderMetadata;
export type AuthProviderFactoryType<Provide, Tokens extends readonly (ClassToken | Token)[]> = FactoryType<
  Provide,
  Tokens
> &
  AuthProviderMetadata;

export type AuthProviderType<
  Provide extends AuthProviderInterface = any,
  Tokens extends readonly (ClassToken | Token)[] = readonly (ClassToken | Token)[],
> =
  | Type<Provide>
  | AuthProviderClassType<Provide>
  | AuthProviderValueType<Provide>
  | AuthProviderFactoryType<Provide, Tokens>;

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
export function AsyncAuthProvider<Provide, const Tokens extends readonly (ClassToken | Token)[]>(
  cfg: AuthProviderFactoryType<Provide, Tokens>,
): AuthProviderFactoryType<Provide, Tokens> {
  return cfg;
}
