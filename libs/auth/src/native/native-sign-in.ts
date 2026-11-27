import { base64urlEncode, generatePkcePair, getSpawnFn, randomBytes } from '@frontmcp/utils';

import { normalizeIssuer } from '../jwks/jwks.utils';
import { assertSecureEndpoint, discoverAuthorizationServer, requestWithTimeout } from './authorization-server-metadata';
import { listenForRedirect } from './loopback-redirect';
import { NativeSignInError } from './native-sign-in.error';
import { memoryTokenStore, type NativeTokenSet, type NativeTokenStore } from './native-token-store';

/** A token is refreshed this long before it expires, so a request never carries one that expires on the way. */
const REFRESH_MARGIN_MS = 60_000;

/** A browser launcher still running this long has handed the URL on, or runs the browser itself, which never exits. */
const LAUNCHER_SETTLE_MS = 2_000;

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
  /** The key the tokens are kept under. @default the issuer, client ID, resources and audience */
  storeKey?: string;
  /**
   * The loopback port (0 to 65535, where 0 is any free port), or an inclusive range of ports from 1 to 65535 to take
   * the first free one from; anything else fails with `invalid_port` before a port is bound. @default any free port
   */
  redirectPort?: number | readonly [number, number];
  /** @default '/callback' */
  redirectPath?: string;
  /**
   * Shows the user the authorization URL. The callback is awaited meanwhile, so one that never settles still ends at
   * `timeoutMs`, and one that fails before the callback comes back fails the sign-in. @default {@link openSystemBrowser}
   */
  openBrowser?: (url: string) => void | Promise<void>;
  /** How long to wait for the browser to come back, in milliseconds. @default 120000 */
  timeoutMs?: number;
}

/** What finds the kept tokens and refreshes them: the sign-in's options, `audience` included, since it is in the key. */
export type NativeTokenOptions = Pick<
  NativeSignInOptions,
  'issuer' | 'clientId' | 'clientSecret' | 'resource' | 'audience' | 'store' | 'storeKey'
>;

const defaultStore = memoryTokenStore();

/**
 * The token operations on one store and key, run one at a time: a read with its refresh, a sign-out, and the save
 * that ends a sign-in. So a refresh in flight can neither undo a sign-out nor replace (or, refused, drop) the tokens
 * of a newer sign-in.
 */
interface TokenLane {
  /** The last operation queued; the next starts once it settles. */
  tail: Promise<unknown>;
  /** A read, with its refresh, that callers share until a sign-in or sign-out is queued behind it. */
  reading?: Promise<NativeTokenSet | undefined>;
  /** Refreshed tokens the store could not save: the server has spent the refresh token they replace. */
  unsaved?: NativeTokenSet;
}

const lanes = new WeakMap<NativeTokenStore, Map<string, TokenLane>>();

function laneOf(store: NativeTokenStore, key: string): TokenLane {
  let byKey = lanes.get(store);
  if (!byKey) lanes.set(store, (byKey = new Map()));
  let lane = byKey.get(key);
  if (!lane) byKey.set(key, (lane = { tail: Promise.resolve() }));
  return lane;
}

function enqueue<T>(lane: TokenLane, operation: () => Promise<T>): Promise<T> {
  const run = lane.tail.then(operation);
  lane.tail = run.catch(() => undefined);
  return run;
}

/** Replaces the kept tokens, after the operations queued before: a sign-in's save, or a sign-out's delete. */
function replaceTokens(store: NativeTokenStore, key: string, tokens: NativeTokenSet | undefined): Promise<void> {
  const lane = laneOf(store, key);
  // A read from before this one must not answer for a caller that comes after it.
  lane.reading = undefined;
  return enqueue(lane, async () => {
    if (tokens) await store.set(key, tokens);
    else await store.delete(key);
    // Only once replaced: a write that fails leaves the store with the refresh token the unsaved ones replace.
    lane.unsaved = undefined;
  });
}

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

    // The callback is awaited while the launcher runs: a launcher that never settles cannot outlast the callback
    // timeout, one that fails first ends the sign-in, and a callback that comes back first is taken.
    const open = options.openBrowser ?? openSystemBrowser;
    const launched = Promise.resolve().then(() => open(authorizationUrl.toString()));
    const code = await Promise.race([redirect.code, launched.then(() => redirect.code)]);

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
    await replaceTokens(storeOf(options), storeKeyOf(options), tokenSet);
    return tokenSet;
  } finally {
    redirect.close();
  }
}

/**
 * The kept tokens, refreshed first when the access token has expired or expires within a minute. Without a refresh
 * token, the access token is returned until it expires. `undefined` when there are none, when they expired and cannot
 * be refreshed, or when the server refused the refresh token, which is then dropped: the app has to sign in again.
 * Callers at the same time share one read and refresh, which waits for a sign-in or sign-out queued before it.
 */
export function getNativeTokens(options: NativeTokenOptions): Promise<NativeTokenSet | undefined> {
  const store = storeOf(options);
  const key = storeKeyOf(options);
  const lane = laneOf(store, key);
  if (lane.reading) return lane.reading;
  const reading: Promise<NativeTokenSet | undefined> = enqueue(lane, () =>
    currentTokens(options, store, key, lane),
  ).finally(() => {
    if (lane.reading === reading) lane.reading = undefined;
  });
  lane.reading = reading;
  return reading;
}

/** Forgets the kept tokens, once a refresh in flight is done, so it cannot sign the caller back in. */
export function signOutNative(options: NativeTokenOptions): Promise<void> {
  return replaceTokens(storeOf(options), storeKeyOf(options), undefined);
}

/**
 * Opens a URL in the system's default browser with `open`, `xdg-open` or `rundll32`. Resolves once the launcher exits
 * with status 0, or is still running 2 seconds after it started, as a launcher that runs the browser itself is: so it
 * can take up to 2 seconds to resolve, while the browser opens. Rejects when the launcher cannot start, or exits with
 * another status first (`browser_launch_failed`), such as `xdg-open` with no browser to hand the URL to.
 */
export function openSystemBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = getSpawnFn()(command, args, { detached: true, stdio: 'ignore' });
    let settled: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      clearTimeout(settled);
      if (error === undefined) resolve();
      else reject(error);
    };
    child.once('error', finish);
    child.once('spawn', () => {
      child.unref();
      settled = setTimeout(finish, LAUNCHER_SETTLE_MS);
      settled.unref?.();
    });
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) return finish();
      const status = code === null ? `signal ${signal}` : `status ${code}`;
      finish(
        new NativeSignInError('browser_launch_failed', `Could not open the browser: ${command} exited with ${status}`),
      );
    });
  });
}

/** The kept tokens, refreshed when due; tokens a refresh could not save are saved before anything else. */
async function currentTokens(
  options: NativeTokenOptions,
  store: NativeTokenStore,
  key: string,
  lane: TokenLane,
): Promise<NativeTokenSet | undefined> {
  let tokens: NativeTokenSet | undefined;
  if (lane.unsaved) {
    tokens = lane.unsaved;
    await store.set(key, tokens);
    lane.unsaved = undefined;
  } else {
    tokens = await store.get(key);
  }
  if (!tokens || !isExpiring(tokens)) return tokens;
  // The margin is for a refresh: an access token nothing can refresh serves until it expires.
  if (!tokens.refreshToken) return (tokens.expiresAt as number) > Date.now() ? tokens : undefined;
  return refreshTokens(options, store, key, tokens, lane);
}

async function refreshTokens(
  options: NativeTokenOptions,
  store: NativeTokenStore,
  key: string,
  tokens: NativeTokenSet,
  lane: TokenLane,
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
  // Kept until saved: the next read saves them rather than send the refresh token the server has spent.
  lane.unsaved = refreshed;
  await store.set(key, refreshed);
  lane.unsaved = undefined;
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

/** A sign-in for another audience gets other tokens, so the audience is part of the key; without one, it is left out. */
function storeKeyOf(options: NativeTokenOptions): string {
  if (options.storeKey) return options.storeKey;
  const audience = options.audience ? [`audience=${options.audience}`] : [];
  return [normalizeIssuer(options.issuer), options.clientId, ...resourcesOf(options), ...audience].join(' ');
}
