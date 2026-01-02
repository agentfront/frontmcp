/**
 * Simple registry base class without indexed lookups.
 *
 * Used for registries that don't need adoption or complex indexing:
 * - AppRegistry
 * - AuthRegistry
 * - FlowRegistry
 */

import { RegistryAbstract, type RegistryKind } from './registry.base.js';

/**
 * Simple registry without indexed lookups or adoption.
 *
 * @typeParam TInstance - Type of registry entry instances
 * @typeParam TRecord - Type of registry records
 * @typeParam TMetadata - Type of initialization metadata
 * @typeParam TProviders - Type of parent provider registry
 */
export abstract class SimpleRegistry<TInstance, TRecord, TMetadata, TProviders = unknown> extends RegistryAbstract<
  TInstance,
  TRecord,
  TMetadata,
  TProviders
> {
  protected constructor(name: RegistryKind, providers: TProviders, metadata: TMetadata, auto = true) {
    super(name, providers, metadata, auto);
  }

  /**
   * Get all entries as an array.
   */
  getAll(): TInstance[] {
    return [...this.instances.values()];
  }

  /**
   * Get entry count.
   */
  count(): number {
    return this.instances.size;
  }
}
