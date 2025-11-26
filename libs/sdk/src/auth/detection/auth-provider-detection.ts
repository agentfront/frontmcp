/**
 * Auth Provider Detection
 *
 * Detects unique auth providers across nested apps and determines
 * if orchestrated mode is required at the parent scope level.
 *
 * When multiple apps have different auth providers, the parent MUST
 * use orchestrated mode to properly manage tokens for each provider.
 */
import { z } from 'zod';
import { AuthOptions, isPublicMode, isTransparentMode, isOrchestratedMode, isOrchestratedRemote } from '../../common';

// ============================================
// Schemas
// ============================================

/**
 * Schema for a detected auth provider
 */
export const detectedAuthProviderSchema = z.object({
  /** Unique provider ID (derived from URL or explicit id) */
  id: z.string(),
  /** Provider URL (for remote providers) */
  providerUrl: z.string().optional(),
  /** Auth mode of this provider */
  mode: z.enum(['public', 'transparent', 'orchestrated']),
  /** App IDs that use this provider */
  appIds: z.array(z.string()),
  /** Collected OAuth scopes from all apps using this provider */
  scopes: z.array(z.string()),
  /** Whether this is the parent's provider */
  isParentProvider: z.boolean(),
});

/**
 * Schema for auth provider detection result
 */
export const authProviderDetectionResultSchema = z.object({
  /** Map of provider ID to detected provider info */
  providers: z.map(z.string(), detectedAuthProviderSchema),
  /** Whether orchestration is required at parent level */
  requiresOrchestration: z.boolean(),
  /** Parent provider ID (if any) */
  parentProviderId: z.string().optional(),
  /** Child provider IDs (excluding parent) */
  childProviderIds: z.array(z.string()),
  /** Total unique provider count */
  uniqueProviderCount: z.number(),
  /** Validation errors (if any) */
  validationErrors: z.array(z.string()),
  /** Warnings (non-fatal issues) */
  warnings: z.array(z.string()),
});

// ============================================
// Types
// ============================================

export type DetectedAuthProvider = z.infer<typeof detectedAuthProviderSchema>;
export type AuthProviderDetectionResult = z.infer<typeof authProviderDetectionResultSchema>;

/**
 * App auth info for detection (minimal interface)
 */
export interface AppAuthInfo {
  id: string;
  name: string;
  auth?: AuthOptions;
}

// ============================================
// Detection Functions
// ============================================

/**
 * Derive a stable provider ID from auth options
 */
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
    // Local orchestrated - use issuer or 'local'
    return options.local?.issuer ?? 'local';
  }

  return 'unknown';
}

/**
 * Convert URL to a safe provider ID
 */
function urlToProviderId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/\./g, '_');
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

/**
 * Extract OAuth scopes from auth options
 */
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

/**
 * Detect all unique auth providers across parent and apps
 *
 * @param parentAuth - Parent scope's auth options (may be undefined)
 * @param apps - Array of app auth info
 * @returns Detection result with providers, validation, and requirements
 */
export function detectAuthProviders(
  parentAuth: AuthOptions | undefined,
  apps: AppAuthInfo[],
): AuthProviderDetectionResult {
  const providers = new Map<string, DetectedAuthProvider>();
  const validationErrors: string[] = [];
  const warnings: string[] = [];
  let parentProviderId: string | undefined;

  // Process parent auth if present
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

  // Process each app's auth
  for (const app of apps) {
    if (!app.auth) {
      // App inherits from parent - skip
      continue;
    }

    const providerId = deriveProviderId(app.auth);
    const existing = providers.get(providerId);

    if (existing) {
      // Same provider - merge app and scopes
      existing.appIds.push(app.id);
      const newScopes = extractScopes(app.auth);
      existing.scopes = [...new Set([...existing.scopes, ...newScopes])];
    } else {
      // New provider
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

  // Determine child provider IDs (non-parent)
  const childProviderIds = [...providers.keys()].filter((id) => id !== parentProviderId);

  // Determine if orchestration is required
  const uniqueProviderCount = providers.size;
  const hasMultipleProviders = uniqueProviderCount > 1;
  const hasChildOnlyProviders = childProviderIds.length > 0 && !parentProviderId;

  const requiresOrchestration =
    hasMultipleProviders || hasChildOnlyProviders || (childProviderIds.length > 0 && parentProviderId !== undefined);

  // Validate configuration
  if (requiresOrchestration && parentAuth && isTransparentMode(parentAuth)) {
    validationErrors.push(
      `Invalid auth configuration: Parent uses transparent mode but apps have their own auth providers. ` +
        `Transparent mode passes tokens through without modification, which is incompatible with multi-provider setups. ` +
        `Change parent auth to orchestrated mode to properly manage tokens for each provider. ` +
        `Detected providers: ${[...providers.keys()].join(', ')}`,
    );
  }

  // Add warnings for potential issues
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

/**
 * Get provider URL from auth options (if remote)
 */
function getProviderUrl(options: AuthOptions): string | undefined {
  if (isTransparentMode(options)) {
    return options.remote.provider;
  }

  if (isOrchestratedMode(options) && isOrchestratedRemote(options)) {
    return options.remote.provider;
  }

  return undefined;
}

/**
 * Check if a specific app requires orchestration
 * (i.e., has a different provider than parent)
 */
export function appRequiresOrchestration(
  appAuth: AuthOptions | undefined,
  parentAuth: AuthOptions | undefined,
): boolean {
  // No app auth = inherits from parent
  if (!appAuth) {
    return false;
  }

  // No parent auth = app manages its own auth
  if (!parentAuth) {
    return appAuth.mode !== 'public';
  }

  // Compare provider IDs
  const appProviderId = deriveProviderId(appAuth);
  const parentProviderId = deriveProviderId(parentAuth);

  return appProviderId !== parentProviderId;
}

/**
 * Get all OAuth scopes needed for a provider across all apps
 */
export function getProviderScopes(detection: AuthProviderDetectionResult, providerId: string): string[] {
  const provider = detection.providers.get(providerId);
  return provider?.scopes ?? [];
}

/**
 * Get apps that use a specific provider
 */
export function getProviderApps(detection: AuthProviderDetectionResult, providerId: string): string[] {
  const provider = detection.providers.get(providerId);
  return provider?.appIds.filter((id) => id !== '__parent__') ?? [];
}
