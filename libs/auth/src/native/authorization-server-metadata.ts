import { trimSlash } from '../jwks/jwks.utils';
import { isLoopbackRedirectUri } from '../utils/redirect-uri.utils';
import { NativeSignInError } from './native-sign-in.error';

const REQUEST_TIMEOUT_MS = 10_000;

/** The parts of an authorization server's RFC 8414 or OpenID metadata a native client signs in with. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  code_challenge_methods_supported?: string[];
  authorization_response_iss_parameter_supported?: boolean;
}

/** Where an issuer's metadata may be, in the order the MCP authorization spec tries them (RFC 8414 §3.1, OpenID Discovery §4). */
export function authorizationServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = trimSlash(url.pathname);
  if (!path) {
    return [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  }
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
}

/**
 * The metadata of the authorization server `issuer` names: the first document found whose `issuer` is that issuer,
 * character for character (RFC 8414 §3.3), with endpoints this client may send credentials to (see
 * {@link assertSecureEndpoint}), well-typed security fields, and S256 PKCE when it lists methods.
 */
export async function discoverAuthorizationServer(issuer: string): Promise<AuthorizationServerMetadata> {
  assertSecureUrl(issuer);
  const problems: string[] = [];
  for (const metadataUrl of authorizationServerMetadataUrls(issuer)) {
    const metadata = await fetchMetadata(metadataUrl);
    if (!metadata) {
      problems.push(`${metadataUrl}: no metadata`);
      continue;
    }
    if (metadata.issuer !== issuer) {
      problems.push(`${metadataUrl}: its issuer is "${metadata.issuer}"`);
      continue;
    }
    assertSecureEndpoint(metadata.authorization_endpoint, issuer);
    assertSecureEndpoint(metadata.token_endpoint, issuer);
    const malformed = securityFieldProblem(metadata);
    if (malformed) throw new NativeSignInError('discovery_failed', `${metadataUrl}: ${malformed}`);
    const methods = metadata.code_challenge_methods_supported;
    if (methods && !methods.includes('S256')) {
      throw new NativeSignInError(
        'discovery_failed',
        `${issuer} does not support S256 PKCE (it lists ${methods.join(', ')})`,
      );
    }
    return metadata;
  }
  throw new NativeSignInError(
    'discovery_failed',
    `No authorization server metadata for ${issuer} (${problems.join('; ')})`,
  );
}

/** HTTPS, or HTTP to a loopback host: an issuer, which may be a local development server. */
export function assertSecureUrl(url: string): void {
  if (protocolOf(url) === 'https:' || (protocolOf(url) === 'http:' && isLoopbackRedirectUri(url))) return;
  throw new NativeSignInError('insecure_url', `${url} is not an https URL`);
}

/**
 * An endpoint of `issuer` this client sends codes, verifiers, refresh tokens or a client secret to: HTTPS, or HTTP to
 * a loopback host only when the issuer is itself an HTTP loopback URL, a local development server. An https issuer's
 * metadata cannot send credentials in the clear to a port on this machine.
 */
export function assertSecureEndpoint(url: string, issuer: string): void {
  assertSecureUrl(url);
  if (protocolOf(url) === 'https:') return;
  if (protocolOf(issuer) === 'http:' && isLoopbackRedirectUri(issuer)) return;
  throw new NativeSignInError(
    'insecure_url',
    `${url} is not an https URL: only an http loopback issuer (a local development server) may use http endpoints`,
  );
}

function protocolOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    throw new NativeSignInError('insecure_url', `"${url}" is not a URL`);
  }
}

/** Why a security field the document carries does not have its RFC 8414 / RFC 9207 type, or `undefined`. */
function securityFieldProblem(metadata: AuthorizationServerMetadata): string | undefined {
  const { authorization_response_iss_parameter_supported: issSupported, code_challenge_methods_supported: methods } =
    metadata as unknown as Record<string, unknown>;
  if (issSupported !== undefined && typeof issSupported !== 'boolean') {
    return 'authorization_response_iss_parameter_supported is not a boolean';
  }
  if (methods !== undefined && !(Array.isArray(methods) && methods.every((method) => typeof method === 'string'))) {
    return 'code_challenge_methods_supported is not a list of strings';
  }
  return undefined;
}

export function requestWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function fetchMetadata(url: string): Promise<AuthorizationServerMetadata | undefined> {
  try {
    const response = await requestWithTimeout(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return undefined;
    const body = (await response.json()) as Partial<AuthorizationServerMetadata> | null;
    if (
      typeof body?.issuer !== 'string' ||
      typeof body.authorization_endpoint !== 'string' ||
      typeof body.token_endpoint !== 'string'
    ) {
      return undefined;
    }
    return body as AuthorizationServerMetadata;
  } catch {
    return undefined;
  }
}
