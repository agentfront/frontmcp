import { base64Encode } from '@frontmcp/utils';

import { RemoteAuthError } from '../errors/remote.errors';

/** The client credentials a remote app authenticates with (`remoteAuth: { mode: 'oauth', clientId, clientSecret }`). */
export interface RemoteOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  scope?: string;
  tokenUrl?: string;
  issuer?: string;
}

/** A token is renewed this long before it expires, so a request never carries one that expires on the way. */
const EXPIRY_MARGIN_MS = 30_000;

interface CachedToken {
  accessToken: string;
  expiresAt?: number;
}

interface TokenEndpoint {
  url: string;
  resource: string;
  postsSecret: boolean;
}

/**
 * Access tokens for one remote, from the OAuth 2.0 client credentials grant. The token endpoint is `tokenUrl`, else the
 * one `issuer` publishes (RFC 8414), else the one of the authorization server the remote's protected resource metadata
 * names (RFC 9728), or of the remote's origin, when that server and its token endpoint are on the remote's origin.
 * Each token request names the remote as its `resource` (RFC 8707), a URL on the remote's origin.
 */
export class RemoteOAuthTokenSource {
  private endpoint?: Promise<TokenEndpoint>;
  private token?: Promise<CachedToken>;

  constructor(
    private readonly appId: string,
    private readonly remoteUrl: string,
    private readonly credentials: RemoteOAuthClientCredentials,
  ) {}

  /** The `Authorization` header value for the next request: the cached token, or a new one once it is about to expire. */
  async authorization(): Promise<string> {
    const current = this.token;
    const next = current
      ? current.then(
          (cached) => (isFresh(cached) ? cached : this.requestToken()),
          () => this.requestToken(),
        )
      : this.requestToken();
    this.token = next;
    return `Bearer ${(await next).accessToken}`;
  }

  /** Drops the cached token, after the remote refused it. */
  invalidate(): void {
    this.token = undefined;
  }

  private async requestToken(): Promise<CachedToken> {
    this.endpoint ??= this.findTokenEndpoint().catch((error: unknown) => {
      this.endpoint = undefined;
      throw error;
    });
    const endpoint = await this.endpoint;
    const { clientId, clientSecret, scope } = this.credentials;
    const body = new URLSearchParams({ grant_type: 'client_credentials', resource: endpoint.resource });
    if (scope) body.set('scope', scope);
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (endpoint.postsSecret) {
      body.set('client_id', clientId);
      body.set('client_secret', clientSecret);
    } else {
      const pair = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
      headers['authorization'] = `Basic ${base64Encode(new TextEncoder().encode(pair))}`;
    }

    const response = await fetch(endpoint.url, { method: 'POST', headers, body: body.toString(), redirect: 'error' });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof answer['access_token'] !== 'string') {
      const reason = typeof answer['error'] === 'string' ? `: ${answer['error']}` : '';
      throw new RemoteAuthError(this.appId, `the token endpoint answered HTTP ${response.status}${reason}`);
    }
    const expiresIn = answer['expires_in'];
    return {
      accessToken: answer['access_token'],
      expiresAt: typeof expiresIn === 'number' ? Date.now() + expiresIn * 1000 : undefined,
    };
  }

  private async findTokenEndpoint(): Promise<TokenEndpoint> {
    const remote = new URL(this.remoteUrl);
    const resourceMetadata = await firstJson(wellKnownUrls(remote, 'oauth-protected-resource'));
    const resource = typeof resourceMetadata?.['resource'] === 'string' ? resourceMetadata['resource'] : this.remoteUrl;
    if (!isOnOrigin(resource, remote.origin)) {
      throw new RemoteAuthError(
        this.appId,
        `the remote's protected resource metadata names the resource ${resource}, which is not on ${remote.origin}, so no token is asked for it`,
      );
    }
    if (this.credentials.tokenUrl) return { url: this.credentials.tokenUrl, resource, postsSecret: false };

    const servers = resourceMetadata?.['authorization_servers'];
    const named = Array.isArray(servers) && typeof servers[0] === 'string' ? servers[0] : remote.origin;
    const configuredIssuer = this.credentials.issuer;
    if (!configuredIssuer && !isOnOrigin(named, remote.origin)) {
      throw new RemoteAuthError(
        this.appId,
        `the remote names the authorization server ${named}, which is not on ${remote.origin}, so the client secret is not sent there; set remoteAuth.issuer (or remoteAuth.tokenUrl) to the server your client credentials are for`,
      );
    }
    const issuer = new URL(configuredIssuer ?? named);
    const serverMetadata = await firstJson([
      ...wellKnownUrls(issuer, 'oauth-authorization-server'),
      ...wellKnownUrls(issuer, 'openid-configuration'),
      new URL(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`),
    ]);
    const tokenUrl = serverMetadata?.['token_endpoint'];
    if (typeof tokenUrl !== 'string') {
      throw new RemoteAuthError(this.appId, `no token endpoint found for ${issuer.href}; set remoteAuth.tokenUrl`);
    }
    if (!configuredIssuer && !isOnOrigin(tokenUrl, remote.origin)) {
      throw new RemoteAuthError(
        this.appId,
        `the authorization server of ${remote.origin} publishes the token endpoint ${tokenUrl}, which is not on that origin, so the client secret is not sent there; set remoteAuth.issuer (or remoteAuth.tokenUrl) to the server your client credentials are for`,
      );
    }
    const methods = serverMetadata?.['token_endpoint_auth_methods_supported'];
    const postsSecret =
      Array.isArray(methods) && !methods.includes('client_secret_basic') && methods.includes('client_secret_post');
    return { url: tokenUrl, resource, postsSecret };
  }
}

/** True when `value` is a URL on `origin`. */
function isOnOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function isFresh(token: CachedToken): boolean {
  return token.expiresAt === undefined || token.expiresAt - EXPIRY_MARGIN_MS > Date.now();
}

/** `/.well-known/<name>` for `url`: with its path appended, then at its origin's root. */
function wellKnownUrls(url: URL, name: string): URL[] {
  const path = url.pathname.replace(/\/$/, '');
  const root = new URL(`/.well-known/${name}`, url.origin);
  return path ? [new URL(`/.well-known/${name}${path}`, url.origin), root] : [root];
}

/** The JSON object of the first of `urls` that answers with one. */
async function firstJson(urls: URL[]): Promise<Record<string, unknown> | undefined> {
  for (const url of urls) {
    const response = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => undefined);
    if (!response?.ok) continue;
    const json: unknown = await response.json().catch(() => undefined);
    if (json && typeof json === 'object') return json as Record<string, unknown>;
  }
  return undefined;
}
