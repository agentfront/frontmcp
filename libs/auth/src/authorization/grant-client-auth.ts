// authorization/grant-client-auth.ts
//
// What a code or refresh token requires of its client at the token endpoint: the
// `token_endpoint_auth_method` recorded when the grant was issued, against the
// method the client authenticates with now (its registration's or CIMD
// document's; undefined where this server has no record of the client).

/** Whether the client may redeem a grant recorded with `recordedMethod`, authenticating with `currentMethod` now. */
export function meetsRecordedClientAuth(
  recordedMethod: string | undefined,
  currentMethod: string | undefined,
): boolean {
  if (recordedMethod === 'none') {
    return true;
  }
  if (recordedMethod === undefined) {
    return currentMethod !== undefined;
  }
  return currentMethod !== undefined && currentMethod !== 'none';
}

/** The method a grant derived from one recorded with `recordedMethod` records: a confidential one is kept. */
export function clientAuthMethodToRecord(
  recordedMethod: string | undefined,
  currentMethod: string | undefined,
): string {
  if (recordedMethod !== undefined && recordedMethod !== 'none') {
    return recordedMethod;
  }
  return currentMethod ?? 'none';
}
