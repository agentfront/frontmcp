// auth/session/session.service.ts
import { Scope } from '../../scope';
import type { CreateSessionArgs } from '@frontmcp/auth';
import { McpSession } from './record/session.mcp';

export class SessionService {
  /**
   * Create a new Session from verified auth data.
   * The returned Session exposes async token helpers, scoped view, and transport JWT helpers.
   */
  createSession(scope: Scope, args: CreateSessionArgs): McpSession {
    return this.createMcpSession(scope, args);
  }

  private createMcpSession(scope: Scope, args: CreateSessionArgs): McpSession {
    const primary = scope.auth;

    const apps = scope.apps.getApps();
    const scopeAppIds = apps.map((app) => app.id);

    // Prefer caller-provided authorizedAppIds, fall back to scope apps
    const authorizedAppIds: string[] = args.authorizedAppIds ?? scopeAppIds;

    // Prefer caller-provided authorizedApps, fall back to building from scope apps
    let authorizedApps: Record<string, { id: string; toolIds: string[] }>;
    if (args.authorizedApps) {
      authorizedApps = args.authorizedApps;
    } else {
      authorizedApps = {};
      for (const app of apps) {
        try {
          const toolNames = app.tools.getTools().map((t) => String(t.metadata.name));
          authorizedApps[app.id] = { id: app.id, toolIds: toolNames };
        } catch {
          // Log for debugging in case of unexpected issues during app registration
          console.warn(`[SessionService] Failed to retrieve tools for app ${app.id}, defaulting to empty toolIds`);
          authorizedApps[app.id] = { id: app.id, toolIds: [] };
        }
      }
    }

    // Providers snapshot - only derive the missing piece, not both
    let authorizedProviders: Record<string, import('@frontmcp/auth').ProviderSnapshot> | undefined =
      args.authorizedProviders;
    let authorizedProviderIds: string[] | undefined = args.authorizedProviderIds;

    // If authorizedProviders exists but authorizedProviderIds is missing, derive from keys
    if (authorizedProviders && !authorizedProviderIds) {
      authorizedProviderIds = Object.keys(authorizedProviders);
    }

    // If authorizedProviders is missing, build from primary/claims
    if (!authorizedProviders) {
      const expClaim = args.claims && typeof args.claims['exp'] === 'number' ? Number(args.claims['exp']) : undefined;
      const providerSnapshot: import('@frontmcp/auth').ProviderSnapshot = {
        id: primary.id,
        exp: expClaim,
        payload: args.claims ?? {},
        apps: authorizedAppIds.map((id) => ({ id, toolIds: authorizedApps[id]?.toolIds ?? [] })),
        embedMode: 'plain',
      };
      authorizedProviders = { [primary.id]: providerSnapshot };
      // Only set authorizedProviderIds if it wasn't already provided
      if (!authorizedProviderIds) {
        authorizedProviderIds = [primary.id];
      }
    }

    // resolve granted scopes from token claims (scope or scp)
    let scopes: string[] = args.scopes ?? [];
    if (!args.scopes) {
      const rawScope: unknown = args.claims ? (args.claims['scope'] ?? args.claims['scp']) : undefined;
      scopes = Array.isArray(rawScope)
        ? rawScope.map(String)
        : typeof rawScope === 'string'
          ? rawScope.split(/[\s,]+/).filter(Boolean)
          : [];
    }

    return new McpSession({
      id: args.token,
      sessionId: args.sessionId,
      scope,
      user: args.user,
      issuer: primary.issuer,
      token: args.token,
      claims: args.claims,
      authorizedProviders,
      authorizedProviderIds,
      authorizedApps,
      authorizedAppIds,
      authorizedResources: args.authorizedResources ?? [],
      scopes,
      authorizedTools: args.authorizedTools,
      authorizedToolIds: args.authorizedToolIds,
      authorizedPrompts: args.authorizedPrompts,
      authorizedPromptIds: args.authorizedPromptIds,
    });
  }
}
