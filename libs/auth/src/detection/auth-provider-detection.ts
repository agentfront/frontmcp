/**
 * Auth Provider Detection
 *
 * Detects unique auth providers across nested apps and determines
 * if orchestrated mode is required at the parent scope level.
 */
import { z } from 'zod';
import { isPublicMode, isTransparentMode, isOrchestratedMode, isOrchestratedRemote } from '../options/utils';
import type { AuthOptions } from '../options/schema';

// ============================================
// Schemas
// ============================================

export const detectedAuthProviderSchema = z.object({
  id: z.string(),
  providerUrl: z.string().optional(),
  mode: z.enum(['public', 'transparent', 'orchestrated']),
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
    return options.remote.id ?? urlToProviderId(options.remote.provider);
  }

  if (isOrchestratedMode(options)) {
    if (isOrchestratedRemote(options)) {
      return options.remote.id ?? urlToProviderId(options.remote.provider);
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
      return options.remote.scopes || [];
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
        `Change parent auth to orchestrated mode to properly manage tokens for each provider. ` +
        `Detected providers: ${[...providers.keys()].join(', ')}`,
    );
  }

  if (uniqueProviderCount > 1 && parentAuth && isPublicMode(parentAuth)) {
    warnings.push(
      `Parent uses public mode but apps have auth providers configured. ` +
        `App-level auth will be used, but consider using orchestrated mode at parent for unified auth management.`,
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
    return options.remote.provider;
  }

  if (isOrchestratedMode(options) && isOrchestratedRemote(options)) {
    return options.remote.provider;
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
