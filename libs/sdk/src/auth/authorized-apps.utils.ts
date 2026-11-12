// auth/authorized-apps.utils.ts
import { decodeJwtPayloadSafe, isOrchestratedMode, type AuthOptions } from '@frontmcp/auth';

/**
 * Progressive/Incremental authorization support.
 *
 * The set of app IDs a verified token may use lives in the `authorized_apps`
 * claim embedded by {@link LocalPrimaryAuth.signAccessToken}. That claim is ONLY
 * present when `incrementalAuth` is enabled for the scope — its ABSENCE is
 * meaningful: no app-level gating (the historical allow-all behavior is
 * preserved). When present, `checkToolAuthorization` enforces that the tool's
 * parent app is a member of the set, and an incremental authorize for a new app
 * mints a fresh token whose claim is the UNION of the prior apps plus the newly
 * authorized one.
 *
 * This mirrors the consent claim model (see `consent.utils.ts`): the grant is
 * carried in verified JWT claims and re-minted via the OAuth code exchange, so
 * it is genuinely enforced rather than tracked in dormant server state.
 */

/**
 * Minimal `authInfo` projection this helper reads from. The HTTP request flow
 * nests the verified user under `extra.user` (claims spread in via
 * `deriveTypedUser`, so `authorized_apps` is present there); other transports
 * may carry the user at the top level. The verified bearer `token` is the
 * last-resort source — decoding it requires NO re-verification because the
 * token already passed `session:verify` before any tool call runs.
 */
interface AuthorizedAppsAuthInfoLike {
  token?: string;
  user?: unknown;
  extra?: unknown;
}

/** Read an `.authorized_apps` field off an arbitrary object-ish value. */
function readAuthorizedApps(source: unknown): unknown {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)['authorized_apps'];
}

/** Read a nested `.user` off an arbitrary object-ish value (for `extra.user`). */
function readUser(source: unknown): unknown {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)['user'];
}

/** Narrow an arbitrary value to a string[] of app ids (or undefined). */
function asAppIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === 'string');
}

/**
 * Extract the authorized-app-id set from a verified `authInfo`.
 *
 * Returns:
 * - a `Set<string>` of authorized app ids when the token carries an
 *   `authorized_apps` claim (the runtime enforcement set), or
 * - `undefined` when there is NO such claim — the caller MUST treat this as
 *   "allow" so the default (incremental-disabled) behavior is preserved.
 *
 * Resolution order (first hit wins): `extra.user.authorized_apps`
 * → `extra.authorized_apps` → `user.authorized_apps` → decode `token`. All
 * sources are equivalent (they derive from the same verified claims); the
 * fallbacks just make enforcement transport-agnostic.
 *
 * Security: this reads ALREADY-VERIFIED claims. The token decode path uses a
 * no-verify payload decode purely to recover the claim that some transports
 * drop from the projected `authInfo`; signature trust was established upstream
 * in `auth:verify` / `session:verify`.
 */
export function getAuthorizedAppIds(authInfo: AuthorizedAppsAuthInfoLike | undefined): Set<string> | undefined {
  if (!authInfo) return undefined;

  const list =
    asAppIdList(readAuthorizedApps(readUser(authInfo.extra))) ??
    asAppIdList(readAuthorizedApps(authInfo.extra)) ??
    asAppIdList(readAuthorizedApps(authInfo.user)) ??
    asAppIdList(decodeJwtPayloadSafe(authInfo.token)?.['authorized_apps']);

  if (!list) return undefined;
  return new Set(list);
}

/** An app as the grant helpers read it. */
interface GrantApp {
  id?: string;
  metadata: { id?: string; name?: string; auth?: unknown };
}

/** The id `authorized_apps` names an app by: the owner id `checkToolAuthorization` compares. */
function grantAppId(app: GrantApp): string {
  return app.id ?? app.metadata.id ?? '';
}

/** Whether a scope mints `authorized_apps`: an orchestrated scope with an `incrementalAuth` block not turned off. */
export function isIncrementalAuthEnabled(authOptions: AuthOptions | undefined): boolean {
  if (!authOptions || !isOrchestratedMode(authOptions)) return false;
  return authOptions.incrementalAuth !== undefined && authOptions.incrementalAuth.enabled !== false;
}

/**
 * The audience of an incremental-authorization ticket: the issuer and path of the scope it is minted for, so a
 * ticket from another server or endpoint that shares the signing secret is refused.
 */
export function incrementalTicketAudience(scope: { fullPath: string; auth?: unknown }): string {
  const issuer = (scope.auth as { issuer?: unknown } | undefined)?.issuer;
  return JSON.stringify([typeof issuer === 'string' ? issuer : '', scope.fullPath]);
}

/**
 * The `authorized_apps` grant of a new sign-in: the requested apps the scope has, or all of its apps when none were
 * requested. Undefined when incremental auth is off, so no claim is minted and apps aren't gated.
 */
export function initialAuthorizedApps(
  authOptions: AuthOptions | undefined,
  apps: readonly GrantApp[],
  requestedAppIds: readonly string[] | undefined,
): string[] | undefined {
  if (!isIncrementalAuthEnabled(authOptions)) return undefined;
  const knownAppIds = new Set(apps.map(grantAppId).filter(Boolean));
  return requestedAppIds ? [...new Set(requestedAppIds)].filter((id) => knownAppIds.has(id)) : [...knownAppIds];
}

/**
 * Drops from `grant` the apps whose own auth provider the sign-in skipped. The provider picker lists an app with its
 * own `auth` under `metadata.id || metadata.name`.
 */
export function withoutSkippedApps(
  grant: readonly string[],
  apps: readonly GrantApp[],
  skippedProviderIds: readonly string[] | undefined,
): string[] {
  if (!skippedProviderIds || skippedProviderIds.length === 0) return [...grant];
  const skippedAppIds = new Set(
    apps
      .filter((app) => app.metadata.auth && skippedProviderIds.includes(app.metadata.id || app.metadata.name || ''))
      .map(grantAppId),
  );
  return grant.filter((id) => !skippedAppIds.has(id));
}
