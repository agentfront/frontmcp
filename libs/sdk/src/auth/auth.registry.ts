// auth/auth.registry.ts
import 'reflect-metadata';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import ProviderRegistry from '../provider/provider.registry';
import {
  AuthOptions,
  FrontMcpAuth,
  AuthProviderType,
  Token,
  AuthProviderEntry,
  AuthRegistryInterface,
  AuthProviderRecord,
  AuthProviderKind,
  EntryOwnerRef,
  PrimaryAuthRecord,
  ScopeEntry,
} from '../common';
import { authDiscoveryDeps, normalizeAuth } from './auth.utils';
import { tokenName } from '../utils/token.utils';
import { RemotePrimaryAuth } from './instances/instance.remote-primary-auth';
import { LocalPrimaryAuth } from './instances/instance.local-primary-auth';
import { DependencyNotFoundError } from '../errors/mcp.error';

export class AuthRegistry
  extends RegistryAbstract<AuthProviderEntry, AuthProviderRecord, AuthProviderType[]>
  implements AuthRegistryInterface
{
  private readonly primary?: FrontMcpAuth;
  private readonly owner: EntryOwnerRef;

  constructor(
    scope: ScopeEntry,
    providers: ProviderRegistry,
    metadata: AuthProviderType[],
    owner: EntryOwnerRef,
    primary?: AuthOptions,
  ) {
    super('AuthRegistry', providers, metadata, false);
    this.owner = owner;
    let primaryRecord: PrimaryAuthRecord;
    if (primary) {
      this.primary =
        primary.type === 'remote'
          ? new RemotePrimaryAuth(scope, providers, primary)
          : new LocalPrimaryAuth(scope, providers, primary);
      primaryRecord = {
        kind: AuthProviderKind.PRIMARY,
        provide: FrontMcpAuth,
        useValue: this.primary,
        metadata: primary,
      };
    } else {
      const defaultMetadata: AuthOptions = { type: 'local', id: 'local', name: 'default-auth', allowAnonymous: true };
      this.primary = new LocalPrimaryAuth(scope, providers, defaultMetadata);
      primaryRecord = {
        kind: AuthProviderKind.PRIMARY,
        provide: FrontMcpAuth,
        useValue: this.primary,
        metadata: defaultMetadata,
      };
    }
    this.tokens.add(FrontMcpAuth);
    this.defs.set(FrontMcpAuth, primaryRecord);
    this.graph.set(FrontMcpAuth, new Set());

    this.buildGraph();
    this.ready = this.initialize();
  }

  protected override buildMap(list: AuthProviderType[]): RegistryBuildMapResult<AuthProviderRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, AuthProviderRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeAuth(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new DependencyNotFoundError('AuthRegistry', tokenName(token));
      }
      const deps = authDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new Error(`AuthProvider ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
        }
        const graphEntry = this.graph.get(token);
        if (!graphEntry) {
          throw new DependencyNotFoundError('AuthRegistry', `graph entry for ${tokenName(token)}`);
        }
        graphEntry.add(d);
      }
    }
  }

  protected async initialize(): Promise<void> {
    if (this.primary) {
      await this.primary.ready;
    }
    return Promise.resolve();
  }

  getPrimary(): FrontMcpAuth {
    if (!this.primary) {
      throw new DependencyNotFoundError('AuthRegistry', 'primary auth provider');
    }
    return this.primary;
  }

  getAuthProviders(): AuthProviderEntry[] {
    return [...this.instances.values()];
  }
}
