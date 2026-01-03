/**
 * @AsyncWith decorator for async dependency resolution.
 *
 * Use this decorator when a class needs async initialization or when
 * you want to avoid TDZ (Temporal Dead Zone) issues with circular imports.
 */

import 'reflect-metadata';
import { META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from '../tokens/di.constants.js';
import type { Token } from '../interfaces/base.interface.js';

/**
 * Decorator that marks a class for async initialization.
 *
 * When a class is decorated with @AsyncWith, the DI container will:
 * 1. Resolve the specified dependency tokens
 * 2. Call the static `with(...deps)` method instead of the constructor
 * 3. Await the result if it's a Promise
 *
 * This is useful for:
 * - Async initialization that requires resolved dependencies
 * - Avoiding TDZ issues with ESM circular imports
 * - Lazy dependency declaration
 *
 * @param tokensFactory - Function returning array of dependency tokens
 * @returns Class decorator
 *
 * @example
 * ```typescript
 * @AsyncWith(() => [DatabaseConnection, Logger])
 * class UserRepository {
 *   private constructor(private db: DatabaseConnection, private logger: Logger) {}
 *
 *   static async with(db: DatabaseConnection, logger: Logger): Promise<UserRepository> {
 *     const repo = new UserRepository(db, logger);
 *     await repo.initialize();
 *     return repo;
 *   }
 *
 *   private async initialize() {
 *     // Async setup
 *   }
 * }
 * ```
 */
export function AsyncWith<T extends readonly Token[]>(tokensFactory: () => T): ClassDecorator {
  return (target: Function) => {
    // Mark the class as using async initialization
    Reflect.defineMetadata(META_ASYNC_WITH, true, target);

    // Store the token factory for later resolution
    Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, tokensFactory, target);
  };
}
