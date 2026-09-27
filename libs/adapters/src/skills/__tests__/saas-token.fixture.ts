/**
 * Test helpers for the `saas` bundle source: a SaaS issuer with a JWKS, and the
 * pinned pull token it issues for one FrontMCP server.
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';

export const SAAS_ISSUER = 'https://cloud.example.dev';
export const SAAS_JWKS_URL = 'https://cloud.example.dev/.well-known/jwks.json';
export const SAAS_AUDIENCE = 'acme:prod';

export interface SaasTokenIssuer {
  /** The JWKS the issuer serves at `SAAS_JWKS_URL`. */
  jwks: { keys: JWK[] };
  /** A pull token for `SAAS_AUDIENCE`, signed by the issuer; `claims` override the defaults. */
  token(claims?: JWTPayload & { exp?: number | string }): Promise<string>;
}

export async function createSaasTokenIssuer(kid = 'saas-2026'): Promise<SaasTokenIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return {
    jwks: { keys: [jwk] },
    token: async (claims = {}) => {
      const { exp, ...rest } = claims;
      return new SignJWT({ iss: SAAS_ISSUER, aud: SAAS_AUDIENCE, sub: 'frontmcp-server', ...rest })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuedAt()
        .setExpirationTime(exp ?? '1h')
        .sign(privateKey);
    },
  };
}

type HttpGet = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

/** Answers the JWKS URL with `issuer`'s JWKS and hands every other request to `stub`. */
export function withSaasJwks(issuer: SaasTokenIssuer, stub: HttpGet): HttpGet {
  return async (url, headers) =>
    url === SAAS_JWKS_URL ? { status: 200, body: JSON.stringify(issuer.jwks) } : stub(url, headers);
}
