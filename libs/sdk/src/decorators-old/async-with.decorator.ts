import 'reflect-metadata';
export const META_ASYNC_WITH = 'mcp:asyncWith';
export const META_ASYNC_WITH_TOKENS = 'mcp:asyncWith:tokens';

/**
 * @AsyncWith(optionalLazyTokens)
 * - Marks a static with(...) as the factory for this provider.
 * - If you pass a lazy resolver, we won't read design:paramtypes (ESM-TDZ safe).
 */
export function AsyncWith(tokens?: () => any[]): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const ctor = (target as any).constructor ?? target; // static method => target is ctor
    Reflect.defineMetadata(META_ASYNC_WITH, true, ctor);
    if (typeof tokens === 'function') {
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, tokens, ctor);
    }
    return descriptor!;
  };
}