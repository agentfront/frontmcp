/**
 * The scopes a token's claims grant: `scope` (RFC 9068 §2.2.3) and `scp` (Entra ID, Okta), each as
 * a space-delimited string or an array, merged without duplicates.
 *
 * @param claims The token's claims (a JWT payload, or the verified user claim built from it).
 */
export function scopesFromClaims(claims: { scope?: unknown; scp?: unknown } | undefined): string[] {
  const scopes = [claims?.scope, claims?.scp].flatMap((claim) => {
    if (typeof claim === 'string') return claim.split(/\s+/).filter(Boolean);
    if (Array.isArray(claim)) return claim.filter((scope): scope is string => typeof scope === 'string');
    return [];
  });
  return [...new Set(scopes)];
}
