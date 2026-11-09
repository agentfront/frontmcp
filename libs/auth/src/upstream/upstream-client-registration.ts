/**
 * Dynamic client registration (RFC 7591) of this server with an upstream provider.
 *
 * Remote mode's `providerConfig.dcrEnabled` uses it when no `clientId` is set: the server
 * registers itself at the provider's `registration_endpoint` (configured, or found in the
 * provider's RFC 8414 / OpenID metadata) and uses the client it gets. With persistent auth
 * storage the client is kept there, its secret sealed with AES-256-GCM, so restarts and
 * other instances reuse it instead of registering again.
 */

import { internalZ as z } from '@frontmcp/lazy-zod';
import {
  base64urlDecode,
  base64urlEncode,
  decryptAesGcm,
  encryptAesGcm,
  hkdfSha256,
  isProduction,
  randomBytes,
  sha256Hex,
  StorageNotSupportedError,
  type StorageAdapter,
} from '@frontmcp/utils';

import { noopAuthLogger, type AuthLogger } from '../common/auth-logger.interface';
import { AuthInternalError } from '../errors/auth-internal.error';
import { normalizeIssuer, trimSlash } from '../jwks/jwks.utils';

const STORAGE_KEY_PREFIX = 'upstream-client:';
const HKDF_SALT = new TextEncoder().encode('frontmcp-upstream-client');
const DEFAULT_TIMEOUT_MS = 10_000;
const SECRET_EXPIRY_MARGIN_SECONDS = 60;
const SUPPORTED_AUTH_METHODS = ['client_secret_post', 'none'];

export interface UpstreamClientRegistrationOptions {
  /** The provider's base URL, which is also its issuer. */
  provider: string;
  /** Where to register; found in the provider's metadata when absent. */
  registrationEndpoint?: string;
  /** The callback URL the provider redirects back to. */
  redirectUri: string;
  /** The `client_name` to register under. */
  clientName: string;
  /** Scopes the client will request. */
  scopes: string[];
  /** Persistent auth storage; without it the client is registered once per process. */
  storage?: StorageAdapter;
  /** Key that seals the stored client (the server's JWT secret). */
  encryptionKey: Uint8Array;
  logger?: AuthLogger;
  /** Timeout for each request to the provider, in milliseconds. @default 10000 */
  timeoutMs?: number;
}

export interface UpstreamClient {
  clientId: string;
  clientSecret?: string;
  /** When the secret expires, in epoch seconds; absent or `0` when it doesn't. */
  clientSecretExpiresAt?: number;
  redirectUri: string;
}

/** Registration with the upstream provider failed, so remote mode has no client to sign in with. */
export class UpstreamClientRegistrationError extends AuthInternalError {
  constructor(provider: string, reason: string) {
    super(
      `Dynamic client registration with ${provider} failed: ${reason}. ` +
        'Register a client at the provider and set clientId (and clientSecret), or fix providerConfig.registrationEndpoint.',
      'UPSTREAM_CLIENT_REGISTRATION_FAILED',
    );
  }
}

const storedClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  clientSecretExpiresAt: z.number().optional(),
  redirectUri: z.string(),
});

const registrationResponseSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  client_secret_expires_at: z.number().optional(),
  redirect_uris: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

const metadataSchema = z.object({
  issuer: z.string().optional(),
  registration_endpoint: z.string().optional(),
});

type CachedClient = { status: 'usable'; client: UpstreamClient } | { status: 'stale' } | { status: 'missing' };

/**
 * The client remote mode signs in with: the stored registration when it is still usable,
 * otherwise a new one registered with the provider.
 *
 * @throws UpstreamClientRegistrationError when no registration endpoint is found or the provider refuses.
 */
export async function resolveUpstreamClient(options: UpstreamClientRegistrationOptions): Promise<UpstreamClient> {
  const logger = options.logger ?? noopAuthLogger;
  const { storage } = options;
  const storageKey = upstreamClientStorageKey(options);
  const cached: CachedClient = storage ? await readStoredClient(storage, options, storageKey) : { status: 'missing' };
  if (cached.status === 'usable') {
    logger.info(`Using client ${cached.client.clientId}, registered earlier with ${options.provider}`);
    return cached.client;
  }

  const registered = await registerUpstreamClient(options);
  logger.info(`Registered client ${registered.clientId} with ${options.provider}`);
  if (!storage) {
    logger.info('No persistent tokenStorage is configured, so the server registers again on its next start');
    return registered;
  }
  return storeClient(storage, options, storageKey, registered, cached.status === 'stale');
}

async function registerUpstreamClient(options: UpstreamClientRegistrationOptions): Promise<UpstreamClient> {
  const endpoint = options.registrationEndpoint ?? (await discoverRegistrationEndpoint(options));
  assertFetchableUrl(options.provider, endpoint);

  const requestBody = {
    client_name: options.clientName,
    redirect_uris: [options.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
    ...(options.scopes.length > 0 ? { scope: options.scopes.join(' ') } : {}),
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(options, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    throw new UpstreamClientRegistrationError(
      options.provider,
      `${endpoint} could not be reached (${describe(error)})`,
    );
  }

  const responseBody: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new UpstreamClientRegistrationError(
      options.provider,
      `${endpoint} answered ${response.status}${describeOAuthError(responseBody)}`,
    );
  }

  const parsed = registrationResponseSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new UpstreamClientRegistrationError(options.provider, `${endpoint} answered without a client_id`);
  }
  const registration = parsed.data;
  if (registration.redirect_uris && !registration.redirect_uris.includes(options.redirectUri)) {
    throw new UpstreamClientRegistrationError(
      options.provider,
      `the provider registered other redirect URIs than ${options.redirectUri}`,
    );
  }
  const authMethod = registration.token_endpoint_auth_method;
  if (authMethod && !SUPPORTED_AUTH_METHODS.includes(authMethod)) {
    (options.logger ?? noopAuthLogger).warn(
      `${options.provider} registered the client for token_endpoint_auth_method "${authMethod}"; ` +
        'FrontMCP sends the client secret in the token request body (client_secret_post)',
    );
  }

  return {
    clientId: registration.client_id,
    clientSecret: registration.client_secret,
    clientSecretExpiresAt: registration.client_secret_expires_at,
    redirectUri: options.redirectUri,
  };
}

/** The `registration_endpoint` of the provider's metadata whose `issuer` names the provider (RFC 8414 §3.3). */
async function discoverRegistrationEndpoint(options: UpstreamClientRegistrationOptions): Promise<string> {
  const logger = options.logger ?? noopAuthLogger;
  const issuer = trimSlash(options.provider);
  const issuerUrl = new URL(issuer);
  const issuerPath = issuerUrl.pathname === '/' ? '' : issuerUrl.pathname;
  const metadataUrls = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${issuer}/.well-known/openid-configuration`,
  ];

  for (const metadataUrl of metadataUrls) {
    const metadata = await fetchMetadata(options, metadataUrl);
    if (!metadata) continue;
    if (normalizeIssuer(metadata.issuer) !== normalizeIssuer(issuer)) {
      logger.warn(`Ignoring ${metadataUrl}: its issuer "${metadata.issuer ?? ''}" is not ${issuer}`);
      continue;
    }
    if (metadata.registration_endpoint) return metadata.registration_endpoint;
  }

  throw new UpstreamClientRegistrationError(
    options.provider,
    `no registration_endpoint found in ${metadataUrls.join(' or ')}`,
  );
}

async function fetchMetadata(
  options: UpstreamClientRegistrationOptions,
  metadataUrl: string,
): Promise<z.infer<typeof metadataSchema> | undefined> {
  assertFetchableUrl(options.provider, metadataUrl);
  try {
    const response = await fetchWithTimeout(options, metadataUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) return undefined;
    const parsed = metadataSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readStoredClient(
  storage: StorageAdapter,
  options: UpstreamClientRegistrationOptions,
  storageKey: string,
): Promise<CachedClient> {
  const logger = options.logger ?? noopAuthLogger;
  let sealed: string | null;
  try {
    sealed = await storage.get(storageKey);
  } catch (error) {
    logger.warn(`Could not read the stored upstream client (${describe(error)}); registering a new one`);
    return { status: 'missing' };
  }
  if (!sealed) return { status: 'missing' };

  const client = openClient(options.encryptionKey, storageKey, sealed);
  if (!client) {
    logger.warn('The stored upstream client could not be decrypted (did JWT_SECRET change?); registering a new one');
    return { status: 'stale' };
  }
  if (client.redirectUri !== options.redirectUri || isSecretExpired(client)) return { status: 'stale' };
  return { status: 'usable', client };
}

/**
 * Store a new registration. A first registration is written only if no other instance stored one
 * meanwhile, and the stored one wins, so every instance uses the same client.
 */
async function storeClient(
  storage: StorageAdapter,
  options: UpstreamClientRegistrationOptions,
  storageKey: string,
  client: UpstreamClient,
  replace: boolean,
): Promise<UpstreamClient> {
  const logger = options.logger ?? noopAuthLogger;
  const sealed = sealClient(options.encryptionKey, storageKey, client);
  const ttlSeconds = secretTtlSeconds(client);

  try {
    if (replace) {
      await storage.set(storageKey, sealed, { ttlSeconds });
      return client;
    }
    try {
      await storage.set(storageKey, sealed, { ttlSeconds, ifNotExists: true });
    } catch (error) {
      if (!(error instanceof StorageNotSupportedError)) throw error;
      await storage.set(storageKey, sealed, { ttlSeconds });
      return client;
    }
    const stored = await storage.get(storageKey);
    const winner = stored ? openClient(options.encryptionKey, storageKey, stored) : undefined;
    if (winner && winner.clientId !== client.clientId) {
      logger.info(`Another instance registered client ${winner.clientId} first; using it`);
      return winner;
    }
  } catch (error) {
    logger.warn(`Could not store the upstream client (${describe(error)}); it is used by this process only`);
  }
  return client;
}

function upstreamClientStorageKey(options: UpstreamClientRegistrationOptions): string {
  const scopes = [...options.scopes].sort().join(' ');
  return `${STORAGE_KEY_PREFIX}${sha256Hex(`${normalizeIssuer(options.provider)}\n${options.redirectUri}\n${scopes}`)}`;
}

function recordKey(encryptionKey: Uint8Array, storageKey: string): Uint8Array {
  return hkdfSha256(encryptionKey, HKDF_SALT, new TextEncoder().encode(storageKey), 32);
}

function sealClient(encryptionKey: Uint8Array, storageKey: string, client: UpstreamClient): string {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(client));
  const { ciphertext, tag } = encryptAesGcm(recordKey(encryptionKey, storageKey), plaintext, iv);
  return JSON.stringify({ iv: base64urlEncode(iv), tag: base64urlEncode(tag), data: base64urlEncode(ciphertext) });
}

function openClient(encryptionKey: Uint8Array, storageKey: string, sealed: string): UpstreamClient | undefined {
  try {
    const envelope = JSON.parse(sealed) as { iv: string; tag: string; data: string };
    const plaintext = decryptAesGcm(
      recordKey(encryptionKey, storageKey),
      base64urlDecode(envelope.data),
      base64urlDecode(envelope.iv),
      base64urlDecode(envelope.tag),
    );
    const parsed = storedClientSchema.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function isSecretExpired(client: UpstreamClient): boolean {
  const expiresAt = client.clientSecretExpiresAt;
  if (!expiresAt) return false;
  return expiresAt - SECRET_EXPIRY_MARGIN_SECONDS <= Math.floor(Date.now() / 1000);
}

function secretTtlSeconds(client: UpstreamClient): number | undefined {
  const expiresAt = client.clientSecretExpiresAt;
  if (!expiresAt) return undefined;
  return Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
}

/** HTTPS, or HTTP for a loopback host or outside production. */
function assertFetchableUrl(provider: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpstreamClientRegistrationError(provider, `"${url}" is not a URL`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  const allowed = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (isLoopback || !isProduction()));
  if (!allowed) {
    throw new UpstreamClientRegistrationError(provider, `${url} is not an https URL`);
  }
}

async function fetchWithTimeout(
  options: UpstreamClientRegistrationOptions,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeOAuthError(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const { error, error_description: description } = body as { error?: unknown; error_description?: unknown };
  if (typeof error !== 'string') return '';
  return typeof description === 'string' ? `: ${error} (${description})` : `: ${error}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
