import { base64urlEncode, generatePkcePair, getSpawnFn, randomBytes } from '@frontmcp/utils';

import { normalizeIssuer } from '../jwks/jwks.utils';
import { assertSecureEndpoint, discoverAuthorizationServer, requestWithTimeout } from './authorization-server-metadata';
import { listenForRedirect } from './loopback-redirect';
import { NativeSignInError } from './native-sign-in.error';
import { memoryTokenStore, type NativeTokenSet, type NativeTokenStore } from './native-token-store';

/** A token is refreshed this long before it expires, so a request never carries one that expires on the way. */
const REFRESH_MARGIN_MS = 60_000;

export interface NativeSignInOptions {
  /** The authorization server's issuer URL; its endpoints come from its RFC 8414 or OpenID metadata. */
  issuer: string;
  clientId: string;
  /** For a provider that gives native apps a client secret; it is sent in the token request body. */
  clientSecret?: string;
  scopes?: string[];
  /** The API or MCP server the tokens are for (RFC 8707), sent on the authorization and token requests. */
  resource?: string | string[];
  /** The `audience` authorization parameter some providers use instead of `resource`. */
  audience?: string;
  /** Where the tokens are kept. @default an in-memory store shared by the process */
  store?: NativeTokenStore;
  /** The key the tokens are kept under. @default the issuer, client ID and resources */
  storeKey?: string;
  /**
   * The loopback port (0 to 65535, where 0 is any free port), or an inclusive range of ports from 1 to 65535 to take
   * the first free one from; anything else fails with `invalid_port` before a port is bound. @default any free port
   */
  redirectPort?: number | readonly [number, number];
  /** @default '/callback' */
  redirectPath?: string;
  /** Shows the user the authorization URL. @default {@link openSystemBrowser} */
  openBrowser?: (url: string) => void | Promise<void>;
  /** How long to wait for the browser to come back, in milliseconds. @default 120000 */
  timeoutMs?: number;
}

export type NativeTokenOptions = Pick<
  NativeSignInOptions,
  'issuer' | 'clientId' | 'clientSecret' | 'resource' | 'store' | 'storeKey'
>;

const defaultStore = memoryTokenStore();
const refreshes = new WeakMap<NativeTokenStore, Map<string, Promise<NativeTokenSet | undefined>>>();

/**
 * Signs a CLI or desktop app in at an OAuth 2.1 authorization server (RFC 8252): discovers its endpoints, opens the
 * authorization URL with S256 PKCE and a loopback redirect, exchanges the code, and keeps the tokens in `store`.
 */
export async function signInNative(options: NativeSignInOptions): Promise<NativeTokenSet> {
  const metadata = await discoverAuthorizationServer(options.issuer);
  const resources = resourcesOf(options);
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = base64urlEncode(randomBytes(32));
  const redirect = await listenForRedirect({
    port: options.redirectPort,
    path: options.redirectPath ?? '/callback',
    timeoutMs: options.timeoutMs ?? 120_000,
    state,
    issuer: metadata.issuer,
    issRequired: metadata.authorization_response_iss_parameter_supported === true,
  });

  try {
    const authorizationUrl = new URL(metadata.authorization_endpoint);
    const query = authorizationUrl.searchParams;
    query.set('response_type', 'code');
    query.set('client_id', options.clientId);
    query.set('redirect_uri', redirect.redirectUri);
    query.set('code_challenge', codeChallenge);
    query.set('code_challenge_method', 'S256');
    query.set('state', state);
    if (options.scopes?.length) query.set('scope', options.scopes.join(' '));
    for (const resource of resources) query.append('resource', resource);
    if (options.audience) query.set('audience', options.audience);

    await (options.openBrowser ?? openSystemBrowser)(authorizationUrl.toString());
    const code = await redirect.code;

    const tokens = await requestTokens(options, metadata.issuer, metadata.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect.redirectUri,
      code_verifier: codeVerifier,
    });
    const tokenSet = toTokenSet(tokens, {
      issuer: metadata.issuer,
      tokenEndpoint: metadata.token_endpoint,
      clientId: options.clientId,
      resource: resources.length ? resources : undefined,
    });
    await storeOf(options).set(storeKeyOf(options), tokenSet);
    return tokenSet;
  } finally {
    redirect.close();
  }
}

/**
 * The kept tokens, refreshed first when the access token has expired or is about to. `undefined` when there are
 * none, or the server refused the refresh token, which is then dropped: the app has to sign in again.
 */
export async function getNativeTokens(options: NativeTokenOptions): Promise<NativeTokenSet | undefined> {
  const store = storeOf(options);
  const key = storeKeyOf(options);
  const tokens = await store.get(key);
  if (!tokens || !isExpiring(tokens)) return tokens;
  if (!tokens.refreshToken) return undefined;

  let pending = refreshes.get(store);
  if (!pending) refreshes.set(store, (pending = new Map()));
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const refresh = refreshTokens(options, store, key, tokens).finally(() => pending.delete(key));
  pending.set(key, refresh);
  return refresh;
}

/** Forgets the kept tokens. */
export async function signOutNative(options: NativeTokenOptions): Promise<void> {
  await storeOf(options).delete(storeKeyOf(options));
}

/** Opens a URL in the system's default browser. */
export function openSystemBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = getSpawnFn()(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function refreshTokens(
  options: NativeTokenOptions,
  store: NativeTokenStore,
  key: string,
  tokens: NativeTokenSet,
): Promise<NativeTokenSet | undefined> {
  let body: Record<string, unknown>;
  try {
    body = await requestTokens(options, tokens.issuer, tokens.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken as string,
    });
  } catch (error) {
    if (error instanceof NativeSignInError && error.code === 'invalid_grant') {
      await store.delete(key);
      return undefined;
    }
    throw error;
  }
  const refreshed = toTokenSet(body, tokens, tokens);
  await store.set(key, refreshed);
  return refreshed;
}

async function requestTokens(
  options: NativeTokenOptions,
  issuer: string,
  tokenEndpoint: string,
  grant: Record<string, string>,
): Promise<Record<string, unknown>> {
  assertSecureEndpoint(tokenEndpoint, issuer);
  const form = new URLSearchParams({ ...grant, client_id: options.clientId });
  if (options.clientSecret) form.set('client_secret', options.clientSecret);
  for (const resource of resourcesOf(options)) form.append('resource', resource);

  const response = await requestWithTimeout(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form,
  });
  const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!response.ok || typeof body?.['access_token'] !== 'string') {
    const error = typeof body?.['error'] === 'string' ? body['error'] : 'invalid_token_response';
    const description = typeof body?.['error_description'] === 'string' ? `: ${body['error_description']}` : '';
    throw new NativeSignInError(error, `The token endpoint answered ${response.status} ${error}${description}`);
  }
  return body;
}

function toTokenSet(
  body: Record<string, unknown>,
  context: Pick<NativeTokenSet, 'issuer' | 'tokenEndpoint' | 'clientId' | 'resource'>,
  previous?: NativeTokenSet,
): NativeTokenSet {
  const text = (name: string) => (typeof body[name] === 'string' ? (body[name] as string) : undefined);
  const expiresIn = Number(body['expires_in']);
  return {
    accessToken: body['access_token'] as string,
    tokenType: text('token_type') ?? 'Bearer',
    refreshToken: text('refresh_token') ?? previous?.refreshToken,
    idToken: text('id_token') ?? previous?.idToken,
    scope: text('scope') ?? previous?.scope,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    issuer: context.issuer,
    tokenEndpoint: context.tokenEndpoint,
    clientId: context.clientId,
    resource: context.resource,
  };
}

function isExpiring(tokens: NativeTokenSet): boolean {
  return tokens.expiresAt !== undefined && tokens.expiresAt - REFRESH_MARGIN_MS <= Date.now();
}

function resourcesOf(options: Pick<NativeSignInOptions, 'resource'>): string[] {
  if (!options.resource) return [];
  return Array.isArray(options.resource) ? options.resource : [options.resource as string];
}

function storeOf(options: Pick<NativeSignInOptions, 'store'>): NativeTokenStore {
  return options.store ?? defaultStore;
}

function storeKeyOf(options: NativeTokenOptions): string {
  return options.storeKey ?? [normalizeIssuer(options.issuer), options.clientId, ...resourcesOf(options)].join(' ');
}
