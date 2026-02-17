import { Reference } from '@frontmcp/sdk';
import type { StoreRegistry } from './providers/store-registry.provider';
import type { StoreAccessor } from './providers/store-accessor.provider';

/**
 * DI token for the store registry (manages all named stores).
 */
export const StoreRegistryToken: Reference<StoreRegistry> = Symbol('plugin:store:registry') as Reference<StoreRegistry>;

/**
 * DI token for the context-scoped store accessor.
 * Use this to access stores in tools.
 */
export const StoreAccessorToken: Reference<StoreAccessor> = Symbol('plugin:store:accessor') as Reference<StoreAccessor>;
