// auth/auth.registry.ts
import 'reflect-metadata';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import ProviderRegistry from '../provider/provider.registry';
import {
  FrontMcpAuth,
  FrontMcpLogger,
  AuthProviderType,
  Token,
  AuthProviderEntry,
  AuthRegistryInterface,
  AuthProviderRecord,
  AuthProviderKind,
  EntryOwnerRef,
  PrimaryAuthRecord,
  ScopeEntry,
  AuthOptions,
  AuthOptionsInput,
  parseAuthOptions,
  isPublicMode,
  isTransparentMode,
  isOrchestratedMode,
  isOrchestratedLocal,
  PublicAuthOptions,
  AppType,
} from '../common';
import { authDiscoveryDeps, normalizeAuth } from './auth.utils';
import { tokenName } from '../utils/token.utils';
import { RemotePrimaryAuth } from './instances/instance.remote-primary-auth';
import { LocalPrimaryAuth } from './instances/instance.local-primary-auth';
import { detectAuthProviders, AuthProviderDetectionResult, AppAuthInfo } from './detection';

/**
 * Default auth options when none provided - public mode with all tools open
 */
const DEFAULT_AUTH_OPTIONS: AuthOptionsInput = {
  mode: 'orchestrated',
  type: 'local',
  allowDefaultPublic: true,
};

export class AuthRegistry
  extends RegistryAbstract<AuthProviderEntry, AuthProviderRecord, AuthProviderType[]>
  implements AuthRegistryInterface
{
  private readonly primary?: FrontMcpAuth;
  private readonly parsedOptions: AuthOptions;
  private readonly logger: FrontMcpLogger;

  /**
   * Detection result for auth providers across the scope hierarchy
   */
  readonly detection: AuthProviderDetectionResult;

  /**
   * Whether this scope requires orchestrated mode
   */
  readonly requiresOrchestration: boolean;

  constructor(
    scope: ScopeEntry,
    providers: ProviderRegistry,
    metadata: AuthProviderType[],
    owner: EntryOwnerRef,
    primaryInput?: AuthOptionsInput,
  ) {
    super('AuthRegistry', providers, metadata, false);

    this.logger = providers.get(FrontMcpLogger).child('AuthRegistry');

    // Parse input with defaults applied
    this.parsedOptions = parseAuthOptions(primaryInput ?? DEFAULT_AUTH_OPTIONS);

    // Detect auth providers across all apps in this scope
    const appAuthInfos = this.extractAppAuthInfo(scope);
    this.detection = detectAuthProviders(this.parsedOptions, appAuthInfos);
    this.requiresOrchestration = this.detection.requiresOrchestration;

    // Log detection results
    this.logDetectionResults();

    // Validate configuration and throw if invalid
    this.validateConfiguration();

    // Create the appropriate primary auth provider based on mode
    this.primary = this.createPrimaryAuth(scope, providers, this.parsedOptions);

    const primaryRecord: PrimaryAuthRecord = {
      kind: AuthProviderKind.PRIMARY,
      provide: FrontMcpAuth,
      useValue: this.primary,
      metadata: this.parsedOptions,
    };

    this.tokens.add(FrontMcpAuth);
    this.defs.set(FrontMcpAuth, primaryRecord);
    this.graph.set(FrontMcpAuth, new Set());

    this.buildGraph();
    this.ready = this.initialize();
  }

  /**
   * Extract AppAuthInfo from scope metadata
   */
  private extractAppAuthInfo(scope: ScopeEntry): AppAuthInfo[] {
    const apps = scope.metadata.apps || [];
    const result: AppAuthInfo[] = [];

    for (const app of apps) {
      // Handle both class-based and value-based app definitions
      const appMeta = this.getAppMetadata(app);
      if (appMeta) {
        result.push({
          id: appMeta.id || appMeta.name,
          name: appMeta.name,
          auth: appMeta.auth,
        });
      }
    }

    return result;
  }

  /**
   * Get app metadata from AppType (handles both class and value types)
   */
  private getAppMetadata(app: AppType): { id?: string; name: string; auth?: AuthOptions } | undefined {
    // Value type: has metadata directly
    if (typeof app === 'object' && 'name' in app) {
      return {
        id: (app as any).id,
        name: (app as any).name,
        auth: (app as any).auth,
      };
    }

    // Class type: check for metadata decorator
    if (typeof app === 'function') {
      const metadata = Reflect.getMetadata('frontmcp:app', app);
      if (metadata) {
        return {
          id: metadata.id,
          name: metadata.name,
          auth: metadata.auth,
        };
      }
    }

    return undefined;
  }

  /**
   * Log detection results for debugging
   */
  private logDetectionResults(): void {
    const { providers, uniqueProviderCount, requiresOrchestration, warnings } = this.detection;

    if (uniqueProviderCount > 1) {
      this.logger.info(`Detected ${uniqueProviderCount} unique auth providers: ${[...providers.keys()].join(', ')}`);
    }

    if (requiresOrchestration) {
      this.logger.info(`Orchestration required: Multiple auth providers detected across apps`);
    }

    // Log warnings
    for (const warning of warnings) {
      this.logger.warn(warning);
    }
  }

  /**
   * Validate configuration and throw if invalid
   */
  private validateConfiguration(): void {
    const { validationErrors } = this.detection;

    if (validationErrors.length > 0) {
      // Log all errors
      for (const error of validationErrors) {
        this.logger.error(`[AuthRegistry] ${error}`);
      }

      // Throw with first error (most important)
      throw new Error(
        `[AuthRegistry] Invalid auth configuration: ${validationErrors[0]}\n` +
          `\nTo fix this issue:\n` +
          `1. Change your parent auth mode from 'transparent' to 'orchestrated'\n` +
          `2. Example:\n` +
          `   auth: {\n` +
          `     mode: 'orchestrated',\n` +
          `     type: 'local', // or 'remote' with your provider config\n` +
          `   }\n`,
      );
    }
  }

  /**
   * Create the appropriate primary auth provider based on parsed options
   */
  private createPrimaryAuth(scope: ScopeEntry, providers: ProviderRegistry, options: AuthOptions): FrontMcpAuth {
    if (isPublicMode(options)) {
      return new LocalPrimaryAuth(scope, providers, options);
    }

    if (isTransparentMode(options)) {
      return new RemotePrimaryAuth(scope, providers, options);
    }

    if (isOrchestratedMode(options)) {
      if (isOrchestratedLocal(options)) {
        return new LocalPrimaryAuth(scope, providers, options);
      } else {
        // Orchestrated remote: local auth server proxying to remote provider
        // TODO: Store remote config for upstream OAuth flows
        return new LocalPrimaryAuth(scope, providers, options);
      }
    }

    // Fallback (should never reach here) - create public mode
    const defaultOptions: PublicAuthOptions = {
      mode: 'public',
      sessionTtl: 3600,
      anonymousScopes: ['anonymous'],
    };
    return new LocalPrimaryAuth(scope, providers, defaultOptions);
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
      const rec = this.defs.get(token)!;
      const deps = authDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new Error(`AuthProvider ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
        }
        this.graph.get(token)!.add(d);
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
    return this.primary!;
  }

  getAuthProviders(): AuthProviderEntry[] {
    return [...this.instances.values()];
  }
}
