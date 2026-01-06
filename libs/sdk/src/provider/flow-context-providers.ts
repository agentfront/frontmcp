/**
 * Flow-Context-Aware Provider Registry
 *
 * This wrapper combines a base ProviderRegistry with context-scoped providers
 * from a flow's deps map. It enables tools to access context-scoped providers
 * (from plugins like RememberPlugin) during execution.
 *
 * The resolution order is:
 * 1. Check context deps (from buildViews) first
 * 2. Fall back to base registry for global/unscoped providers
 */

import { Token } from '@frontmcp/di';
import {
  ProviderRegistryInterface,
  RegistryKind,
  RegistryType,
  ProviderViews,
  ScopeEntry,
  ProviderEntry,
} from '../common';

export class FlowContextProviders implements ProviderRegistryInterface {
  constructor(
    private readonly baseProviders: ProviderRegistryInterface,
    private readonly contextDeps: ReadonlyMap<Token, unknown>,
  ) {}

  get<T>(token: Token<T>): T {
    // Check context deps first (includes context-scoped providers from plugins)
    if (this.contextDeps.has(token)) {
      return this.contextDeps.get(token) as T;
    }
    // Fall back to base providers for global/unscoped providers
    return this.baseProviders.get(token);
  }

  getScope(): ScopeEntry {
    return this.baseProviders.getScope();
  }

  getProviders(): ProviderEntry[] {
    return this.baseProviders.getProviders();
  }

  getRegistries<T extends RegistryKind>(type: T): RegistryType[T][] {
    return this.baseProviders.getRegistries(type);
  }

  buildViews(session: any): Promise<ProviderViews> {
    return this.baseProviders.buildViews(session);
  }
}
