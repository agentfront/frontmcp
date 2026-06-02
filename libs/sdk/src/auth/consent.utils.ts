// auth/consent.utils.ts
import { decodeJwtPayloadSafe } from '@frontmcp/auth';

/**
 * Shape of the `consent` claim embedded in a FrontMCP-minted access token by
 * {@link LocalPrimaryAuth.signAccessToken}:
 *
 * ```json
 * { "consent": { "enabled": true, "selectedTools": ["app:tool", ...] } }
 * ```
 *
 * Only present when consent mode was enabled for the authorization that minted
 * the token. Its ABSENCE is meaningful: consent disabled ⇒ no enforcement.
 */
export interface ConsentClaim {
  enabled?: boolean;
  selectedTools?: string[];
}

/**
 * Minimal `authInfo` projection this helper reads from. The HTTP request flow
 * nests the verified user under `extra.user` (claims spread in via
 * `deriveTypedUser`, so `consent` is present there); other transports may carry
 * the user at the top level. The verified bearer `token` is the last-resort
 * source — decoding it requires NO re-verification because the token already
 * passed `session:verify` before any tool call runs.
 */
interface ConsentAuthInfoLike {
  token?: string;
  // `user`/`extra` are read structurally (we only reach for `.consent`); typed
  // loosely so the MCP SDK's `AuthInfo` (and its `UserClaim`-typed `extra.user`)
  // assigns without friction. Access goes through narrow helpers below.
  user?: unknown;
  extra?: unknown;
}

/** Read a `.consent` field off an arbitrary object-ish value. */
function readConsent(source: unknown): unknown {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)['consent'];
}

/** Read a nested `.user` off an arbitrary object-ish value (for `extra.user`). */
function readUser(source: unknown): unknown {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)['user'];
}

/** Narrow an arbitrary value to a {@link ConsentClaim} (or undefined). */
function asConsentClaim(value: unknown): ConsentClaim | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const claim = value as ConsentClaim;
  if (claim.enabled !== true) return undefined;
  return claim;
}

/**
 * Extract the consented tool-id set from a verified `authInfo`.
 *
 * Returns:
 * - a `Set<string>` of selected tool ids when the token carries an ENABLED
 *   `consent` claim (the runtime enforcement set), or
 * - `undefined` when there is NO consent metadata — the caller MUST treat this
 *   as "allow" so the default (consent-disabled) behavior is preserved.
 *
 * Resolution order (first hit wins): `extra.user.consent` → `extra.consent`
 * → `user.consent` → decode `token`. All sources are equivalent (they derive
 * from the same verified claims); the fallbacks just make enforcement
 * transport-agnostic.
 *
 * Security: this reads ALREADY-VERIFIED claims. The token decode path uses a
 * no-verify payload decode purely to recover the `consent` claim that some
 * transports drop from the projected `authInfo`; signature trust was
 * established upstream in `auth:verify` / `session:verify`.
 */
export function getConsentedToolIds(authInfo: ConsentAuthInfoLike | undefined): Set<string> | undefined {
  if (!authInfo) return undefined;

  const claim =
    asConsentClaim(readConsent(readUser(authInfo.extra))) ??
    asConsentClaim(readConsent(authInfo.extra)) ??
    asConsentClaim(readConsent(authInfo.user)) ??
    asConsentClaim(decodeJwtPayloadSafe(authInfo.token)?.['consent']);

  if (!claim) return undefined;

  const selected = Array.isArray(claim.selectedTools) ? claim.selectedTools.filter((t) => typeof t === 'string') : [];
  return new Set(selected);
}

/**
 * Test whether a tool id is permitted by the consent set returned from
 * {@link getConsentedToolIds}.
 *
 * - `consented === undefined` (no consent metadata) ⇒ always allowed.
 * - otherwise the tool id must be a member of the set.
 *
 * `toolIds` accepts the tool's candidate identifiers (e.g. `fullName` and bare
 * `name`); the tool is allowed if ANY of them was consented, matching the
 * available-tool ids surfaced on the consent screen.
 */
export function isToolConsented(consented: Set<string> | undefined, ...toolIds: Array<string | undefined>): boolean {
  if (!consented) return true;
  return toolIds.some((id) => id !== undefined && consented.has(id));
}
