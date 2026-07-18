// authorization/dcr-client.registry.ts
//
// Local Authorization Server Dynamic Client Registration (DCR) registry (#462).
//
// Holds the set of OAuth clients the LOCAL AS will accept and enforces the
// declarative `dcr` control surface (enabled flag, redirect_uri / client_id
// allowlists, initial access token). Pre-registered trusted clients are seeded
// at construction so the authorize/token flows accept them without a DCR
// round-trip.
//
// This is instance state on `LocalPrimaryAuth` (not a module-level Map) so each
// server gets an isolated registry and tests don't bleed into one another. No
// PII is stored — only OAuth client metadata.

import { sha256, timingSafeEqual } from '@frontmcp/utils';

/** A registered OAuth client record held by the local AS. */
export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method:
    | 'none'
    | 'client_secret_basic'
    | 'client_secret_post'
    | 'private_key_jwt'
    | 'tls_client_auth';
  grant_types: string[];
  response_types: string[];
  redirect_uris: string[];
  client_name?: string;
  scope?: string;
  /** Seconds since epoch when the client was registered/seeded. */
  created_at: number;
  /** True for clients minted by DCR (vs pre-registered trusted clients). */
  dev: boolean;
  /** True for clients declared via `dcr.clients` (seeded at startup). */
  preRegistered?: boolean;
}

/** Shape of a pre-registered client as declared in `dcr.clients`. */
export interface PreRegisteredClientInput {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
  grantTypes?: Array<'authorization_code' | 'refresh_token'>;
  responseTypes?: Array<'code'>;
  scope?: string;
}

/** Resolved DCR configuration consumed by the registry. */
export interface DcrRegistryConfig {
  /**
   * Whether DCR (`POST /oauth/register`) is active. `undefined` means "defer to
   * the historical environment guard" (on in dev, off in production), which the
   * register flow resolves; the registry treats `undefined` as "not explicitly
   * disabled".
   */
  enabled?: boolean;
  allowedRedirectUris?: string[];
  allowedClientIds?: string[];
  initialAccessToken?: string;
  clients?: PreRegisteredClientInput[];
  /**
   * Maximum number of DYNAMICALLY-registered (DCR) clients kept in memory.
   * Once the cap is reached, further dynamic registrations are REJECTED (rather
   * than evicting an existing client), so every already-registered client —
   * including confidential ones — is preserved. Pre-registered / declarative
   * clients never count toward this cap and are never rejected. Defaults to
   * 1000. Guards against unbounded growth from unauthenticated DCR.
   */
  maxDynamicClients?: number;
}

/** Default cap on dynamically-registered clients when not configured. */
const DEFAULT_MAX_DYNAMIC_CLIENTS = 1000;

/**
 * Compile a simple-glob (`*` = any run of characters) or exact pattern into a
 * RegExp. Every other character is matched literally, so a plain URL with no
 * `*` becomes an exact match.
 */
function globToRegExp(pattern: string): RegExp {
  // Split on the `*` wildcard, regex-escape each literal segment (so real
  // spaces and other characters are matched literally), then join the segments
  // with `.*`. This avoids using an in-band sentinel character (a space) that
  // could collide with a literal space in the pattern.
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = pattern.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${body}$`);
}

/**
 * Local-AS DCR client registry. Seeded from `dcr.clients` at construction and
 * mutated by `POST /oauth/register` at runtime.
 */
export class DcrClientRegistry {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly redirectMatchers: RegExp[] | undefined;

  constructor(private readonly config: DcrRegistryConfig = {}) {
    this.redirectMatchers = config.allowedRedirectUris?.map(globToRegExp);
    this.seedPreRegisteredClients();
  }

  /** Seed `dcr.clients` so the authorize/token flows accept them without DCR. */
  private seedPreRegisteredClients(): void {
    const clients = this.config.clients ?? [];
    const now = Math.floor(Date.now() / 1000);
    for (const c of clients) {
      this.clients.set(c.clientId, {
        client_id: c.clientId,
        client_secret: c.clientSecret,
        token_endpoint_auth_method: c.tokenEndpointAuthMethod ?? 'none',
        grant_types: c.grantTypes ?? ['authorization_code'],
        response_types: c.responseTypes ?? ['code'],
        redirect_uris: c.redirectUris,
        client_name: c.clientName,
        scope: c.scope,
        created_at: now,
        dev: false,
        preRegistered: true,
      });
    }
  }

  /** Look up a client by id (pre-registered or dynamically registered). */
  get(clientId: string): RegisteredClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Authenticate a client at the token endpoint (RFC 6749 §2.3 / §3.2.1).
   *
   * - `'unknown'`  — the client id is not registered (caller decides; today's
   *   public / CIMD clients are unregistered and treated as "no secret to
   *   verify").
   * - `'ok'`       — public client (`none`), or a confidential client whose
   *   presented secret matched (constant-time).
   * - `'invalid'`  — a confidential client with a missing or wrong secret. The
   *   caller MUST reject with `invalid_client`.
   *
   * SECURITY: previously the token endpoint verified only `client_id` equality,
   * so a DCR-minted `client_secret` was never checked and a "confidential"
   * client was effectively public. This restores confidential-client
   * authentication with a timing-safe comparison.
   */
  verifyClientSecret(clientId: string, presentedSecret: string | undefined): 'unknown' | 'ok' | 'invalid' {
    const client = this.clients.get(clientId);
    if (!client) return 'unknown';
    const method = client.token_endpoint_auth_method;
    const isConfidential = method === 'client_secret_basic' || method === 'client_secret_post';
    if (!isConfidential) return 'ok';
    // A confidential client with no stored secret is a server misconfiguration;
    // fail closed rather than silently accept an empty secret.
    if (!client.client_secret) return 'invalid';
    if (!presentedSecret) return 'invalid';
    // Compare fixed-length SHA-256 digests to avoid leaking length/content via timing.
    return timingSafeEqual(sha256(presentedSecret), sha256(client.client_secret)) ? 'ok' : 'invalid';
  }

  /** Whether a client id is known to the registry. */
  has(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  /**
   * Add a dynamically-registered client (called by the register flow).
   *
   * @returns `true` if the client was registered, `false` if the dynamic-client
   * capacity is already reached.
   *
   * SECURITY: `POST /oauth/register` may be unauthenticated (no
   * `initialAccessToken`); without a bound an attacker can register unlimited
   * clients and exhaust memory. Once the cap is reached we REJECT new dynamic
   * registrations rather than evicting an existing one — this preserves every
   * already-registered client (including confidential ones with a
   * `client_secret`), which eviction would have silently invalidated. The
   * register flow surfaces `false` as a `temporarily_unavailable` error.
   * Pre-registered / declarative clients are exempt and never count toward the
   * cap.
   */
  register(client: RegisteredClient): boolean {
    const cap = this.dynamicClientCap();
    const dynamicCount = this.countDynamicClients();
    // Re-registering an existing dynamic client id is an update, not growth.
    const isNew = !this.clients.has(client.client_id);
    if (isNew && dynamicCount >= cap) {
      return false;
    }
    this.clients.set(client.client_id, client);
    return true;
  }

  /** Configured dynamic-client cap, falling back to the default when invalid. */
  private dynamicClientCap(): number {
    const configured = this.config.maxDynamicClients;
    // A negative / NaN / non-integer cap would either disable the bound or throw
    // during comparison — fall back to the safe default instead.
    return Number.isSafeInteger(configured) && (configured as number) >= 0
      ? (configured as number)
      : DEFAULT_MAX_DYNAMIC_CLIENTS;
  }

  private countDynamicClients(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.dev && !c.preRegistered) n++;
    return n;
  }

  /** Whether a redirect_uri allowlist is configured. */
  hasRedirectAllowlist(): boolean {
    return !!this.redirectMatchers && this.redirectMatchers.length > 0;
  }

  /**
   * Whether `redirectUri` is permitted by the configured allowlist. Always
   * `true` when no allowlist is configured (preserves default behavior).
   */
  isRedirectUriAllowed(redirectUri: string): boolean {
    if (!this.redirectMatchers || this.redirectMatchers.length === 0) {
      return true;
    }
    return this.redirectMatchers.some((re) => re.test(redirectUri));
  }

  /** Whether a client-id allowlist is configured. */
  hasClientIdAllowlist(): boolean {
    return !!this.config.allowedClientIds && this.config.allowedClientIds.length > 0;
  }

  /**
   * Whether `clientId` is permitted by the configured client-id allowlist.
   * Always `true` when no allowlist is configured (preserves default behavior).
   */
  isClientIdAllowed(clientId: string): boolean {
    const allow = this.config.allowedClientIds;
    if (!allow || allow.length === 0) {
      return true;
    }
    return allow.includes(clientId);
  }

  /** Whether an initial access token is required for DCR registration. */
  requiresInitialAccessToken(): boolean {
    return typeof this.config.initialAccessToken === 'string' && this.config.initialAccessToken.length > 0;
  }

  /**
   * Constant-time check of a presented bearer token against the configured
   * initial access token. Returns `false` when none is configured (callers
   * should gate on {@link requiresInitialAccessToken} first).
   */
  verifyInitialAccessToken(presented: string | undefined): boolean {
    const expected = this.config.initialAccessToken;
    if (!expected) {
      return false;
    }
    if (typeof presented !== 'string' || presented.length === 0) {
      return false;
    }
    // Hash both sides to fixed-length (32-byte) digests before the constant-time
    // compare, so neither the comparison time nor `timingSafeEqual`'s
    // equal-length requirement leaks the token length.
    return timingSafeEqual(sha256(presented), sha256(expected));
  }
}
