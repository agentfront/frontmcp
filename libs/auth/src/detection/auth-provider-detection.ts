/**
 * Auth Provider Detection
 *
 * Detects unique auth providers across nested apps and determines
 * if orchestrated mode is required at the parent scope level.
 */
import { z } from '@frontmcp/lazy-zod';

import type { AuthOptions } from '../options/schema';
import {
  isOrchestratedMode,
  isOrchestratedRemote,
  isPublicMode,
  isStaticMode,
  isTransparentMode,
} from '../options/utils';

// ============================================
// Schemas
// ============================================

export const detectedAuthProviderSchema = z.object({
  id: z.string(),
  providerUrl: z.string().optional(),
  mode: z.enum(['public', 'static', 'transparent', 'local', 'remote']),
  appIds: z.array(z.string()),
  scopes: z.array(z.string()),
  isParentProvider: z.boolean(),
});

export const authProviderDetectionResultSchema = z.object({
  providers: z.map(z.string(), detectedAuthProviderSchema),
  requiresOrchestration: z.boolean(),
  parentProviderId: z.string().optional(),
  childProviderIds: z.array(z.string()),
  uniqueProviderCount: z.number(),
  validationErrors: z.array(z.string()),
  warnings: z.array(z.string()),
});

// ============================================
// Types
// ============================================

export type DetectedAuthProvider = z.infer<typeof detectedAuthProviderSchema>;
export type AuthProviderDetectionResult = z.infer<typeof authProviderDetectionResultSchema>;

export interface AppAuthInfo {
  id: string;
  name: string;
  auth?: AuthOptions;
}

// ============================================
// Detection Functions
// ============================================

export function deriveProviderId(options: AuthOptions): string {
  if (isPublicMode(options)) {
    return options.issuer ?? 'public';
  }

  if (isTransparentMode(options)) {
    return options.providerConfig?.id ?? urlToProviderId(options.provider);
  }

  if (isOrchestratedMode(options)) {
    if (isOrchestratedRemote(options)) {
      return options.providerConfig?.id ?? urlToProviderId(options.provider);
    }
    return options.local?.issuer ?? 'local';
  }

  return 'unknown';
}

function urlToProviderId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/\./g, '_');
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

function extractScopes(options: AuthOptions): string[] {
  if (isTransparentMode(options)) {
    return options.requiredScopes || [];
  }

  if (isOrchestratedMode(options)) {
    if (isOrchestratedRemote(options)) {
      return options.scopes || [];
    }
  }

  return [];
}

export function detectAuthProviders(
  parentAuth: AuthOptions | undefined,
  apps: AppAuthInfo[],
): AuthProviderDetectionResult {
  const providers = new Map<string, DetectedAuthProvider>();
  const validationErrors: string[] = [];
  const warnings: string[] = [];
  let parentProviderId: string | undefined;

  if (parentAuth) {
    parentProviderId = deriveProviderId(parentAuth);

    providers.set(parentProviderId, {
      id: parentProviderId,
      providerUrl: getProviderUrl(parentAuth),
      mode: parentAuth.mode,
      appIds: ['__parent__'],
      scopes: extractScopes(parentAuth),
      isParentProvider: true,
    });
  }

  for (const app of apps) {
    if (!app.auth) {
      continue;
    }

    const providerId = deriveProviderId(app.auth);
    const existing = providers.get(providerId);

    if (existing) {
      existing.appIds.push(app.id);
      const newScopes = extractScopes(app.auth);
      existing.scopes = [...new Set([...existing.scopes, ...newScopes])];
    } else {
      providers.set(providerId, {
        id: providerId,
        providerUrl: getProviderUrl(app.auth),
        mode: app.auth.mode,
        appIds: [app.id],
        scopes: extractScopes(app.auth),
        isParentProvider: false,
      });
    }
  }

  const childProviderIds = [...providers.keys()].filter((id) => id !== parentProviderId);
  const uniqueProviderCount = providers.size;
  const hasMultipleProviders = uniqueProviderCount > 1;
  const hasChildOnlyProviders = childProviderIds.length > 0 && !parentProviderId;

  const requiresOrchestration =
    hasMultipleProviders || hasChildOnlyProviders || (childProviderIds.length > 0 && parentProviderId !== undefined);

  if (requiresOrchestration && parentAuth && isTransparentMode(parentAuth)) {
    validationErrors.push(
      `Invalid auth configuration: Parent uses transparent mode but apps have their own auth providers. ` +
        `Transparent mode passes tokens through without modification, which is incompatible with multi-provider setups. ` +
        `Change parent auth to local or remote mode to properly manage tokens for each provider. ` +
        `Detected providers: ${[...providers.keys()].join(', ')}`,
    );
  }

  const sharedEndpointUnenforced = !parentAuth || isPublicMode(parentAuth) || isStaticMode(parentAuth);
  const unenforcedAppIds = apps
    .filter((app) => app.auth && !isPublicMode(app.auth) && deriveProviderId(app.auth) !== parentProviderId)
    .map((app) => app.id);
  if (sharedEndpointUnenforced && unenforcedAppIds.length > 0) {
    validationErrors.push(
      `App-level auth is not enforced on the shared endpoint of a server in ${parentAuth?.mode ?? 'public'} mode, ` +
        `so the tools of ${unenforcedAppIds.join(', ')} would be served without it. ` +
        `Run the server in local or remote mode (it federates each app's provider and checks the app's grant on ` +
        `every tool call), or serve the app on its own endpoint with standalone: true or splitByApp: true.`,
    );
  }

  return {
    providers,
    requiresOrchestration,
    parentProviderId,
    childProviderIds,
    uniqueProviderCount,
    validationErrors,
    warnings,
  };
}

function getProviderUrl(options: AuthOptions): string | undefined {
  if (isTransparentMode(options)) {
    return options.provider;
  }

  if (isOrchestratedMode(options) && isOrchestratedRemote(options)) {
    return options.provider;
  }

  return undefined;
}

export function appRequiresOrchestration(
  appAuth: AuthOptions | undefined,
  parentAuth: AuthOptions | undefined,
): boolean {
  if (!appAuth) {
    return false;
  }

  if (!parentAuth) {
    return appAuth.mode !== 'public';
  }

  const appProviderId = deriveProviderId(appAuth);
  const parentProviderId = deriveProviderId(parentAuth);

  return appProviderId !== parentProviderId;
}

export function getProviderScopes(detection: AuthProviderDetectionResult, providerId: string): string[] {
  const provider = detection.providers.get(providerId);
  return provider?.scopes ?? [];
}

export function getProviderApps(detection: AuthProviderDetectionResult, providerId: string): string[] {
  const provider = detection.providers.get(providerId);
  return provider?.appIds.filter((id) => id !== '__parent__') ?? [];
}
