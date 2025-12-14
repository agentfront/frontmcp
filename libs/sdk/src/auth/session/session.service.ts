// auth/session/session.service.ts
import { StatelessSession } from './record/session.stateless';
import { StatefulSession } from './record/session.stateful';
import { Scope } from '../../scope';
import { CreateSessionArgs } from './session.types';
import { TransparentSession } from './record/session.transparent';
import { ScopedInMemoryStore } from '../../store';

export class SessionService {
  private store = new ScopedInMemoryStore();

  /**
   * Create and persist a new Session from verified auth data.
   * The returned Session exposes async token helpers, scoped view, and transport JWT helpers.
   */
  async createSession(scope: Scope, args: CreateSessionArgs) {
    if (scope.orchestrated) {
      return this.createOrchestratedSession(scope, args);
    } else {
      return this.createTransparentSession(scope, args);
    }
  }

  private createOrchestratedSession(scope: Scope, args: CreateSessionArgs) {
    const stateless = scope.metadata.transport?.sessionMode === 'stateless';
    if (stateless) {
      return new StatelessSession(args as any);
    } else {
      return new StatefulSession(args as any);
    }
  }

  private createTransparentSession(scope: Scope, args: CreateSessionArgs) {
    const primary = scope.auth;

    const apps = scope.apps.getApps();
    const appIds = apps.map((app) => app.id);

    // Prefer precomputed projections when provided
    let authorizedApps: Record<string, { id: string; toolIds: string[] }> = args.authorizedApps ?? {};
    if (!args.authorizedApps) {
      authorizedApps = {};
      for (const app of apps) {
        try {
          const toolNames = app.tools.getTools().map((t) => String(t.metadata.name));
          authorizedApps[app.id] = { id: app.id, toolIds: toolNames };
        } catch {
          authorizedApps[app.id] = { id: app.id, toolIds: [] };
        }
      }
    }

    // TODO: the authorized resources should be computed from the oauth-protected-resource flow
    // let authorizedResources: string[] = args.authorizedResources ?? [];
    // if (!args.authorizedResources) {
    //   authorizedResources = [];
    // }

    // Providers snapshot
    let authorizedProviders = args.authorizedProviders;
    let authorizedProviderIds = args.authorizedProviderIds;
    if (!authorizedProviders || !authorizedProviderIds) {
      const expClaim =
        args.claims && typeof (args.claims as any)['exp'] === 'number'
          ? Number((args.claims as any)['exp'])
          : undefined;
      const providerSnapshot = {
        id: primary.id,
        exp: expClaim,
        payload: args.claims ?? {},
        apps: appIds.map((id) => ({ id, toolIds: authorizedApps[id]?.toolIds ?? [] })),
        embedMode: 'plain' as const,
      };
      authorizedProviders = { [primary.id]: providerSnapshot } as any;
      authorizedProviderIds = [primary.id];
    }

    // resolve granted scopes from token claims (scope or scp)
    let scopes: string[] = args.scopes ?? [];
    if (!args.scopes) {
      const rawScope = (args.claims && ((args.claims as any)['scope'] ?? (args.claims as any)['scp'])) as unknown;
      scopes = Array.isArray(rawScope)
        ? rawScope.map(String)
        : typeof rawScope === 'string'
        ? rawScope.split(/[\s,]+/).filter(Boolean)
        : [];
    }

    return new TransparentSession({
      apps: appIds,
      id: args.token,
      sessionId: args.sessionId,
      scope,
      user: args.user,
      issuer: primary.issuer,
      token: args.token,
      claims: args.claims,
      authorizedProviders: authorizedProviders as any,
      authorizedProviderIds: authorizedProviderIds as any,
      authorizedApps,
      authorizedAppIds: appIds,
      authorizedResources: [], // TODO: fix
      scopes,
      authorizedTools: args.authorizedTools,
      authorizedToolIds: args.authorizedToolIds,
      authorizedPrompts: args.authorizedPrompts,
      authorizedPromptIds: args.authorizedPromptIds,
    } as any);
  }
}
