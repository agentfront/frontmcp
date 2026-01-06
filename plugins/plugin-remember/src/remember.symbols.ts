import { Reference } from '@frontmcp/sdk';
import type { RememberStoreInterface } from './providers/remember-store.interface';
import type { RememberAccessor } from './providers/remember-accessor.provider';
import type { RememberPluginOptions } from './remember.types';

/**
 * DI token for the underlying storage provider.
 */
export const RememberStoreToken: Reference<RememberStoreInterface> = Symbol(
  'plugin:remember:store',
) as Reference<RememberStoreInterface>;

/**
 * DI token for the plugin configuration.
 */
export const RememberConfigToken: Reference<RememberPluginOptions> = Symbol(
  'plugin:remember:config',
) as Reference<RememberPluginOptions>;

/**
 * DI token for the context-scoped RememberAccessor.
 * Use this to access remember functionality in tools and agents.
 *
 * @example
 * ```typescript
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     const remember = this.get(RememberAccessorToken);
 *     await remember.set('key', 'value');
 *   }
 * }
 * ```
 */
export const RememberAccessorToken: Reference<RememberAccessor> = Symbol(
  'plugin:remember:accessor',
) as Reference<RememberAccessor>;
