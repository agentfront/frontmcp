import { DcrClientMetadata, DcrPolicyOptions, RegistrarIdentity, RegistrationAccessTokenClaims, URLString } from './dcr.types';

// ---- Token helpers (stubs to integrate with your JWT service)
export async function verifyInitialAccessToken(authzHeader?: string): Promise<RegistrarIdentity> {
  if (!authzHeader?.startsWith('Bearer ')) throw makeHttpError(401, 'invalid_token');
  const token = authzHeader.slice('Bearer '.length).trim();
  // TODO: verify signature, expiry, scope contains dcr:register
  // Return registrar identity bound to token
  return { org_id: 'org_example', user_id: 'user_example', env: 'dev', scopes: ['dcr:register'] };
}

export async function issueRegistrationAccessToken(claims: RegistrationAccessTokenClaims, ttlSeconds = 86400): Promise<string> {
  // TODO: mint JWT or opaque token in your auth service
  return `rat_${claims.client_id}_${Date.now()}`;
}

export async function verifyRegistrationAccessToken(authzHeader?: string, expectedClientId?: string): Promise<RegistrationAccessTokenClaims> {
  if (!authzHeader?.startsWith('Bearer ')) throw makeHttpError(401, 'invalid_token');
  const token = authzHeader.slice('Bearer '.length).trim();
  // TODO: verify + parse; for now expect format rat_<clientId>_<ts>
  if (!token.startsWith('rat_')) throw makeHttpError(401, 'invalid_token');
  const parts = token.split('_');
  const client_id = parts[1];
  if (expectedClientId && client_id !== expectedClientId) throw makeHttpError(403, 'forbidden');
  return { client_id, scope: ['dcr:manage'] };
}

// ---- SSA (Software Statement) validation stub
export async function verifySoftwareStatement(jwt?: string, registrar?: RegistrarIdentity): Promise<void> {
  if (!jwt) return; // optional
  // TODO: verify JWT (iss/aud/exp/sub), ensure registrar/org match allowed set; enforce constraints in metadata
}

// ---- URL validation & SSRF guards
export function isHttpsUrl(u?: string): boolean {
  if (!u) return false;
  try { const x = new URL(u); return x.protocol === 'https:'; } catch { return false; }
}

export function isPublicUrl(u?: string): boolean {
  if (!u) return false;
  try {
    const x = new URL(u);
    const host = x.hostname;
    // very light guard; replace with CIDR checks for RFC1918/localhost/link-local
    const privateHosts = ['localhost', '127.0.0.1'];
    return !privateHosts.includes(host);
  } catch { return false; }
}

export async function safeFetchJwks(uri: URLString): Promise<any> {
  if (!isHttpsUrl(uri) || !isPublicUrl(uri)) throw makeHttpError(400, 'invalid_jwks_uri');
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 2000);
  const res = await fetch(uri, { signal: ac.signal });
  clearTimeout(to);
  if (!res.ok) throw makeHttpError(400, 'jwks_fetch_failed');
  const text = await res.text();
  if (text.length > 64 * 1024) throw makeHttpError(400, 'jwks_too_large');
  try { return JSON.parse(text); } catch { throw makeHttpError(400, 'jwks_not_json'); }
}

// ---- Metadata validation
export function validateClientMetadata(meta: DcrClientMetadata, policy: DcrPolicyOptions): void {
  if (!Array.isArray(meta.redirect_uris) || meta.redirect_uris.length === 0) throw makeHttpError(400, 'invalid_redirect_uris');
  if (meta.redirect_uris.length > policy.maxRedirects) throw makeHttpError(400, 'too_many_redirect_uris');

  for (const u of meta.redirect_uris) {
    if (policy.httpsOnlyRedirects && !isHttpsUrl(u)) throw makeHttpError(400, 'redirect_not_https');
    if (!policy.allowLocalhost && !isPublicUrl(u)) throw makeHttpError(400, 'redirect_not_public');
  }

  const method = meta.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!policy.allowedAuthMethods.includes(method)) throw makeHttpError(400, 'unsupported_auth_method');

  if (method === 'private_key_jwt') {
    if (!meta.jwks && !meta.jwks_uri) throw makeHttpError(400, 'jwks_required_for_private_key_jwt');
  }

  // Defaults
  meta.grant_types = meta.grant_types ?? ['authorization_code'];
  meta.response_types = meta.response_types ?? ['code'];
  meta.token_endpoint_auth_method = method;
}

// ---- Small HTTP error helper
export function makeHttpError(status: number, code: string, detail?: any) {
  const err = new Error(code) as any;
  err.status = status;
  err.code = code;
  err.detail = detail;
  return err;
}
