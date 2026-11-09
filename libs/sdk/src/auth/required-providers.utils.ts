import { isOrchestratedMode, type AuthOptions } from '@frontmcp/auth';

/** An app as the provider picker reads it. */
interface PickerApp {
  metadata: { id?: string; name?: string; auth?: unknown };
}

/** Whether a sign-in may leave app providers for later: not under `incrementalAuth.allowSkip: false`. */
export function allowsSkippingApps(authOptions: AuthOptions | undefined): boolean {
  return !(authOptions && isOrchestratedMode(authOptions) && authOptions.incrementalAuth?.allowSkip === false);
}

/**
 * The providers a sign-in through the provider picker must link: `federatedAuth.requiredProviders`, and with
 * `incrementalAuth.allowSkip: false` the provider of every app with its own `auth`, which the picker lists under
 * `metadata.id || metadata.name`.
 */
export function requiredProviderIds(authOptions: AuthOptions | undefined, apps: readonly PickerApp[]): string[] {
  if (!authOptions || !isOrchestratedMode(authOptions)) return [];
  const configured = authOptions.federatedAuth?.requiredProviders ?? [];
  if (allowsSkippingApps(authOptions)) return configured;
  const appProviderIds = apps
    .filter((app) => app.metadata.auth)
    .map((app) => app.metadata.id || app.metadata.name || '')
    .filter(Boolean);
  return [...new Set([...configured, ...appProviderIds])];
}
