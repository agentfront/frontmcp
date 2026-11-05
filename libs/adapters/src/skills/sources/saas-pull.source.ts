// file: libs/adapters/src/skills/sources/saas-pull.source.ts

// All Node APIs route through `@frontmcp/utils` (env-aware via `#path` and
// `#fs` subpath imports + assertNode guards). The build pipeline
// (`frontmcp build --target <env>`) picks the right resolution per target.
import { JwksService, type JSONWebKeySet } from '@frontmcp/auth';
import type { FrontMcpLogger } from '@frontmcp/sdk';
import {
  dirname,
  ensureDir,
  isRedirectResponse,
  pathResolve,
  readFile,
  sha256Base64url,
  writeFile,
} from '@frontmcp/utils';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { OverlayParseError, parseOverlay } from '../bundle/overlay-parser';
import { createStorageReplayNonceStore, type ReplayNonceStore } from '../security/replay-nonce-store';
import { WebhookReplayGuard, type ReplayRejectCode } from '../security/webhook-replay-guard';
import type { SaasSourceOptions } from '../source-options';
import type {
  BundleOrigin,
  BundlePullFailureListener,
  BundlePushReceiver,
  BundleSourceDeps,
  BundleSourceListener,
  BundleTokenFailure,
  SkillBundleSource,
} from './skill-bundle-source.interface';

const DEFAULT_CACHE_DIR = '.frontmcp/skilled-openapi';
const DEFAULT_PULL_TIMEOUT_MS = 30_000;
const USER_AGENT = 'frontmcp-skilled-openapi';
/** How long the push path reuses the issuer's signing keys, so unauthenticated pushes can't each fetch the JWKS. */
const PUSH_SIGNING_KEYS_TTL_MS = 60_000;
const MAX_LISTED_ISSUES = 3;

/**
 * The pinned pull token failed verification against `jwksUrl`, `expectedIssuer`
 * or `expectedAudience`. Unlike an outage, this never falls back to a cached
 * bundle: the configured SaaS is not the one the server was set up to trust.
 */
export class SaasPullTokenRejectedError extends Error {
  constructor(
    reason: string,
    readonly tokenFailure: BundleTokenFailure,
  ) {
    super(`[saas-source] pull token rejected: ${reason}`);
    this.name = 'SaasPullTokenRejectedError';
  }
}

/** The issuer's JWKS could not be read, or holds no usable signing key: no token can be checked, an outage. */
export class SaasJwksUnavailableError extends Error {
  readonly tokenFailure = 'jwks_unavailable';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SaasJwksUnavailableError';
  }
}

/**
 * The token of a pushed bundle was refused: it fails the checks the pull token passes (`invalid-token`), a push
 * already used it (`replayed`), or the replay store could not record its `jti` (`replay-unchecked`). The pushed
 * bundle is not applied.
 */
export class SaasPushRefusedError extends Error {
  constructor(
    readonly refusal: 'invalid-token' | 'replayed' | 'replay-unchecked',
    reason: string,
    /** The check that refused the token, when the issuer's checks did rather than the replay guard. */
    readonly tokenFailure?: BundleTokenFailure,
  ) {
    super(`[saas-source] push refused${tokenFailure ? ` (${tokenFailure})` : ''}: ${reason}`);
    this.name = 'SaasPushRefusedError';
  }
}

/** The token check a pull or push failed on, from the error it threw; undefined for any other failure. */
export function tokenFailureOf(error: unknown): BundleTokenFailure | undefined {
  if (error instanceof SaasPullTokenRejectedError || error instanceof SaasJwksUnavailableError) {
    return error.tokenFailure;
  }
  return error instanceof SaasPushRefusedError ? error.tokenFailure : undefined;
}

type TokenVerdict =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: string; tokenFailure: BundleTokenFailure };

/** The push token claim that binds it to the body it came with: {@link pushBodyDigest} of that body. */
export const PUSH_BODY_DIGEST_CLAIM = 'body_sha256';

/** The `body_sha256` claim a push token carries for `body`: the base64url SHA-256 of its exact bytes, unpadded. */
export function pushBodyDigest(body: string | Uint8Array): string {
  return sha256Base64url(body);
}

/** The key prefix of the push token `jti`s a shared replay store keeps, followed by the source's audience. */
const PUSH_JTI_NAMESPACE = 'frontmcp:skilled-openapi:push-jti';

function pushRefusalFor(code: ReplayRejectCode | undefined): SaasPushRefusedError['refusal'] {
  if (code === 'nonce_replay') return 'replayed';
  if (code === 'store_unavailable') return 'replay-unchecked';
  return 'invalid-token';
}

/** Why a pull failed, with the first issues the bundle checks found when the bundle was the problem. */
function describePullFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof OverlayParseError) || !error.errors?.length) return message;
  return `${message}: ${error.errors.slice(0, MAX_LISTED_ISSUES).join('; ')}`;
}

/** Claim values as a list: RFC 7519 allows a single string or an array. */
function claimValues(claim: unknown): unknown[] {
  if (Array.isArray(claim)) return claim;
  return claim === undefined ? [] : [claim];
}

/** Public-key members each asymmetric key type needs (RFC 7518 §6, RFC 8037 §2). */
const PUBLIC_KEY_MEMBERS = new Map<string, readonly string[]>([
  ['RSA', ['n', 'e']],
  ['EC', ['crv', 'x', 'y']],
  ['OKP', ['crv', 'x']],
]);

/**
 * Whether a JWKS entry could verify a pull token: an asymmetric public key with its members,
 * not marked for encryption. Symmetric (`oct`) keys never can: verification is pinned to
 * asymmetric algorithms.
 */
function isUsableSigningKey(key: unknown): boolean {
  if (typeof key !== 'object' || key === null) return false;
  const jwk = key as Record<string, unknown>;
  const members = typeof jwk['kty'] === 'string' ? PUBLIC_KEY_MEMBERS.get(jwk['kty']) : undefined;
  if (!members || (jwk['use'] !== undefined && jwk['use'] !== 'sig')) return false;
  return members.every((m) => typeof jwk[m] === 'string' && jwk[m] !== '');
}

/**
 * Pulls bundles from a configured SaaS endpoint via authenticated HTTPS.
 *
 * Boot semantics:
 *   - Always attempts a fresh pull on `start()`.
 *   - If the pull fails AND a cached bundle exists on disk, falls back to it,
 *     emits a warning, and hands it to its listeners with why the pull failed.
 *     This prevents a SaaS outage at boot from killing the customer's MCP
 *     server. The cache holds the last bundle the plugin applied
 *     ({@link SaasPullSource.keepBundle}): a pulled bundle that fails its
 *     signature or apply never replaces it.
 *   - If both pull and cache fail, `start()` throws. Polling still starts, so a
 *     later pull that succeeds loads the bundle.
 *
 * Refresh: poll on `pollIntervalMs`. Single-flight per source — overlapping
 * polls are skipped, never queued. A poll that fails is logged and reported to
 * the {@link SaasPullSource.onPullFailure} listeners. With `enableWebhook` the
 * source also takes pushed bundles ({@link SaasPullSource.verifyPushToken}):
 * the plugin serves them at `POST /__skilled_openapi/push`, and a push token
 * with a `body_sha256` claim is good only for the body it was issued for.
 *
 * Before every pull the pinned `authToken` is verified: it must be a JWT signed
 * by a key in the issuer's JWKS (`jwksUrl`), with `iss` equal to
 * `expectedIssuer` and `aud` including `expectedAudience` (and `resource` too,
 * when the token carries one), and not expired. A rejected token stops the pull
 * and is never answered with the cached bundle ({@link SaasPullTokenRejectedError});
 * an unreachable JWKS, or one with no usable signing key, is treated like any
 * other pull failure (the cache fallback still applies).
 *
 * NOTE: Bundle signature verification is applied by the bundle-sync service
 * before the bundle becomes active, and so is the version order: the source is
 * {@link SaasPullSource.forwardOnly}, so a bundle older than the served one is refused.
 */
export class SaasPullSource implements SkillBundleSource, BundlePushReceiver {
  readonly id: string;

  private listeners = new Set<BundleSourceListener>();
  private pullFailureListeners = new Set<BundlePullFailureListener>();
  private pollHandle: NodeJS.Timeout | undefined;
  /** The pull running now, from start, a poll or a refresh; only one runs at a time. */
  private inFlightPull: Promise<unknown> | undefined;
  private stopped = false;
  private readonly jwksService = new JwksService({});
  private readonly replayGuard?: WebhookReplayGuard;
  private pushSigningKeys?: { keys: unknown[]; fetchedAt: number };
  private pushSigningKeysLoading?: Promise<unknown[]>;
  private warnedOfUnboundPushToken = false;

  constructor(
    private readonly options: SaasSourceOptions,
    private readonly cacheDir: string | undefined,
    private readonly logger: FrontMcpLogger,
    private readonly deps: BundleSourceDeps = {},
  ) {
    this.id = `saas:${this.options.endpoint}`;
    if (options.enableWebhook) this.replayGuard = new WebhookReplayGuard({ store: this.pushReplayStore() });
  }

  /** The store an injected `pushReplayStore` or the `pushReplayStorage` option names; none keeps the jtis in memory. */
  private pushReplayStore(): ReplayNonceStore | undefined {
    if (this.deps.pushReplayStore) return this.deps.pushReplayStore;
    const { pushReplayStorage, expectedAudience } = this.options;
    if (!pushReplayStorage) return undefined;
    return createStorageReplayNonceStore(pushReplayStorage, `${PUSH_JTI_NAMESPACE}:${expectedAudience}`);
  }

  /** This source, when `enableWebhook` is on: it then takes bundles pushed to the server. */
  get push(): BundlePushReceiver | undefined {
    return this.replayGuard ? this : undefined;
  }

  /** A pulled or pushed bundle older than the one being served is not applied, unless `allowRollback` is on. */
  get forwardOnly(): boolean {
    return !this.options.allowRollback;
  }

  /**
   * Check the token of a pushed bundle: by the rules the pull token passes (a key in `jwksUrl`, `iss`, `aud`,
   * `resource`, expiry), then against `body`, the exact bytes of the request body ({@link PUSH_BODY_DIGEST_CLAIM}),
   * then by the replay guard, so its `iat` must be within five minutes and its `jti` unused by every instance sharing
   * the replay store. A token refused for its body leaves its `jti` unused. Throws {@link SaasPushRefusedError}, or
   * {@link SaasJwksUnavailableError} when the JWKS can't be read.
   */
  async verifyPushToken(token: string, body: Uint8Array): Promise<void> {
    if (!this.replayGuard) {
      throw new SaasPushRefusedError(
        'invalid-token',
        'this source does not take pushed bundles (enableWebhook is off)',
      );
    }
    const verdict = await this.verifyIssuedToken(token, await this.signingKeysForPush());
    if (!verdict.ok) throw new SaasPushRefusedError('invalid-token', verdict.reason, verdict.tokenFailure);
    const { iat, jti } = verdict.claims;
    if (typeof iat !== 'number' || typeof jti !== 'string') {
      throw new SaasPushRefusedError('invalid-token', 'a push token needs "iat" and "jti" claims', 'missing_claim');
    }
    this.checkPushBody(verdict.claims[PUSH_BODY_DIGEST_CLAIM], body);
    const replay = await this.replayGuard.check({ timestampMs: iat * 1000, nonce: jti });
    if (!replay.ok) {
      throw new SaasPushRefusedError(pushRefusalFor(replay.code), `its "jti" or "iat" claim: ${replay.reason}`);
    }
  }

  /** Refuse a push whose body isn't the one its token was issued for, or, with `requirePushBodyDigest`, unbound. */
  private checkPushBody(claimedDigest: unknown, body: Uint8Array): void {
    if (claimedDigest === undefined) {
      if (this.options.requirePushBodyDigest) {
        throw new SaasPushRefusedError(
          'invalid-token',
          `a push token needs a "${PUSH_BODY_DIGEST_CLAIM}" claim (requirePushBodyDigest is on)`,
          'missing_claim',
        );
      }
      if (!this.warnedOfUnboundPushToken) {
        this.warnedOfUnboundPushToken = true;
        this.logger.warn(
          `[saas-source] ${this.id}: a push token carries no "${PUSH_BODY_DIGEST_CLAIM}" claim, so it isn't bound to its body; set requirePushBodyDigest to refuse such tokens`,
        );
      }
      return;
    }
    if (claimedDigest !== pushBodyDigest(body)) {
      throw new SaasPushRefusedError(
        'invalid-token',
        `its "${PUSH_BODY_DIGEST_CLAIM}" claim is not the SHA-256 of the pushed body`,
        'body_mismatch',
      );
    }
  }

  /** Keep a bundle the plugin applied, pulled or pushed, as the last good one a start falls back to. */
  keepBundle(bundle: ResolvedBundle): Promise<void> {
    return this.persistCache(bundle);
  }

  async start(): Promise<void> {
    // Single flight: a Cron Trigger can call refresh() during a cold start, and its pull is then the one in
    // flight, so start() skips its own rather than race it. The check and the set have no await between them.
    if (this.stopped || this.inFlightPull) {
      this.schedulePoll();
      return;
    }
    try {
      await this.exclusivePull(() => this.pullAtStart());
    } finally {
      this.schedulePoll();
    }
  }

  private async pullAtStart(): Promise<void> {
    let bundle: ResolvedBundle | undefined;
    try {
      bundle = await this.fetchOnce();
    } catch (e) {
      // A rejected pull token means the SaaS is not the one this server trusts:
      // serving the cached bundle would hide that, so fail instead.
      if (e instanceof SaasPullTokenRejectedError) throw e;
      const failure = describePullFailure(e);
      this.logger.warn(`[saas-source] initial pull failed (${failure}); attempting cached bundle fallback`);
      bundle = await this.loadCache();
      if (!bundle) {
        throw new Error(
          `[saas-source] initial pull failed and no cached bundle is available ${this.cacheLocation()}: ${failure}`,
          { cause: e },
        );
      }
      this.logger.warn(`[saas-source] using cached bundle "${bundle.bundleId}@${bundle.version}"`);
      await this.notify(bundle, { pullFailure: failure, tokenFailure: tokenFailureOf(e) });
      return;
    }
    await this.notify(bundle);
  }

  /** Run `pull` as the one pull in flight, so a start, a poll and a refresh never pull at once. */
  private exclusivePull<T>(pull: () => Promise<T>): Promise<T> {
    const running = pull().finally(() => {
      this.inFlightPull = undefined;
    });
    this.inFlightPull = running;
    return running;
  }

  onChange(listener: BundleSourceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to the polls that fail, with why; a failed start or refresh throws to its caller instead. */
  onPullFailure(listener: BundlePullFailureListener): () => void {
    this.pullFailureListeners.add(listener);
    return () => {
      this.pullFailureListeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }
    this.listeners.clear();
    this.pullFailureListeners.clear();
  }

  private schedulePoll(): void {
    // `disablePolling` is for runtimes with no background execution (Cloudflare
    // Workers) — a Cron Trigger / DO alarm calls `refresh()` instead.
    if (this.stopped || this.deps.disablePolling) return;
    // Clear any prior handle before scheduling — pollOnce's skip-path and its
    // finally-reschedule could otherwise overwrite `pollHandle` and leak a
    // dangling timer that fires an extra poll.
    if (this.pollHandle) clearTimeout(this.pollHandle);
    this.pollHandle = setTimeout(() => {
      void this.pollOnce();
    }, this.options.pollIntervalMs);
    this.pollHandle.unref?.();
  }

  /**
   * Manually pull a fresh bundle and notify listeners, resolving once they are
   * done with it (the plugin applied and kept it, or refused it). Drive this
   * from a Cron Trigger / Durable Object alarm on runtimes without background
   * timers (where `disablePolling` is set). Single-flight: while a pull is
   * already in flight it waits for that pull to finish, applied and kept, and
   * returns `undefined` without pulling again; throws if its own pull fails (the
   * caller — e.g. a scheduled handler — decides how to surface it).
   */
  async refresh(): Promise<ResolvedBundle | undefined> {
    if (this.stopped) return undefined;
    if (this.inFlightPull) {
      await this.inFlightPull.catch(() => undefined);
      return undefined;
    }
    return this.exclusivePull(async () => {
      const bundle = await this.fetchOnce();
      await this.notify(bundle);
      return bundle;
    });
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlightPull) {
      // Skip; previous poll still running.
      this.schedulePoll();
      return;
    }
    try {
      await this.exclusivePull(async () => {
        const bundle = await this.fetchOnce();
        await this.notify(bundle);
      });
    } catch (e) {
      const failure = describePullFailure(e);
      if (e instanceof SaasPullTokenRejectedError) {
        this.logger.error(`[saas-source] poll refused: ${failure}; keeping the current bundle`);
      } else {
        this.logger.warn(`[saas-source] poll failed: ${failure}`);
      }
      this.notifyPullFailure(failure, tokenFailureOf(e));
    } finally {
      this.schedulePoll();
    }
  }

  // Indirected so tests can stub the network call.
  protected async httpGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    // Bound the request so a hung SaaS endpoint can't pin the in-flight pull
    // forever and silently disable polling. AbortError surfaces as a normal
    // fetch failure to the caller, which the surrounding catch already
    // treats as a pull failure with optional cache fallback.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_PULL_TIMEOUT_MS);
    try {
      // Never follow a redirect: the request carries the bearer token, and only the configured endpoint may receive it.
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal, redirect: 'manual' });
      if (isRedirectResponse(res)) {
        throw new Error(`pull endpoint returned a redirect (${res.status}); not followed to protect the bearer token`);
      }
      const body = await res.text();
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Verify the pinned pull token against the issuer's JWKS, issuer and audience, and log the check it fails on.
   * Throws {@link SaasPullTokenRejectedError} when the token is refused, and {@link SaasJwksUnavailableError} when
   * the JWKS can't be fetched (an outage).
   */
  private async verifyPullToken(): Promise<void> {
    try {
      const verdict = await this.verifyIssuedToken(this.options.authToken, await this.fetchSigningKeys());
      if (!verdict.ok) throw new SaasPullTokenRejectedError(verdict.reason, verdict.tokenFailure);
    } catch (error) {
      const tokenFailure = tokenFailureOf(error);
      if (tokenFailure) this.logger.warn(`[saas-source] ${this.id}: pull token check failed (${tokenFailure})`);
      throw error;
    }
  }

  /**
   * The issuer's signing keys for checking a push token: fetched at most once a minute, and shared by concurrent
   * pushes. A pull always fetches them, so a key the issuer removed stops a pull at once.
   */
  private signingKeysForPush(): Promise<unknown[]> {
    const cached = this.pushSigningKeys;
    if (cached && Date.now() - cached.fetchedAt < PUSH_SIGNING_KEYS_TTL_MS) return Promise.resolve(cached.keys);
    this.pushSigningKeysLoading ??= this.fetchSigningKeys()
      .then((keys) => {
        this.pushSigningKeys = { keys, fetchedAt: Date.now() };
        return keys;
      })
      .finally(() => {
        this.pushSigningKeysLoading = undefined;
      });
    return this.pushSigningKeysLoading;
  }

  private async fetchSigningKeys(): Promise<unknown[]> {
    const { jwksUrl } = this.options;
    // The JWKS is public: never send the pull token with it.
    const { status, body } = await this.httpGet(jwksUrl, {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    }).catch((error: unknown) => {
      throw new SaasJwksUnavailableError(describePullFailure(error), { cause: error });
    });
    if (status < 200 || status >= 300) {
      throw new SaasJwksUnavailableError(`JWKS ${jwksUrl} responded ${status}`);
    }
    let jwks: JSONWebKeySet;
    try {
      jwks = JSON.parse(body) as JSONWebKeySet;
    } catch {
      throw new SaasJwksUnavailableError(`JWKS ${jwksUrl} is not valid JSON`);
    }
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new SaasJwksUnavailableError(`JWKS ${jwksUrl} has no keys`);
    }
    // A JWKS with no key that could verify a token says nothing about the token: treat it like an
    // unreachable JWKS (a pull failure), and keep SaasPullTokenRejectedError for a token that a
    // usable key set refuses.
    const signingKeys = (jwks.keys as unknown[]).filter(isUsableSigningKey);
    if (signingKeys.length === 0) {
      throw new SaasJwksUnavailableError(`JWKS ${jwksUrl} has no usable signing keys`);
    }
    return signingKeys;
  }

  /** Check a token the issuer signed, against its JWKS, issuer and audience. */
  private async verifyIssuedToken(token: string, signingKeys: unknown[]): Promise<TokenVerdict> {
    const { jwksUrl, expectedIssuer, expectedAudience } = this.options;
    const verified = await this.jwksService.verifyTransparentToken(token, [
      { id: 'skilled-openapi-saas', issuerUrl: expectedIssuer, jwks: { keys: signingKeys } as JSONWebKeySet },
    ]);
    if (!verified.ok || !verified.payload) {
      return {
        ok: false,
        reason: `not a valid token from issuer "${expectedIssuer}" signed by a key in ${jwksUrl} (${verified.error ?? 'verification failed'})`,
        tokenFailure: verified.failure ?? 'malformed',
      };
    }
    const payload = verified.payload;
    if (!claimValues(payload['aud']).includes(expectedAudience)) {
      return {
        ok: false,
        reason: `its "aud" claim does not include "${expectedAudience}"`,
        tokenFailure: 'wrong_audience',
      };
    }
    // RFC 8707: a token that names its resource must name this audience too.
    const resource = claimValues(payload['resource']);
    if (resource.length > 0 && !resource.includes(expectedAudience)) {
      return {
        ok: false,
        reason: `its "resource" claim does not include "${expectedAudience}"`,
        tokenFailure: 'wrong_audience',
      };
    }
    return { ok: true, claims: payload };
  }

  private async fetchOnce(): Promise<ResolvedBundle> {
    await this.verifyPullToken();
    const { status, body } = await this.httpGet(this.options.endpoint, {
      Authorization: `Bearer ${this.options.authToken}`,
      Accept: 'application/json, application/yaml',
      'User-Agent': USER_AGENT,
    });
    if (status < 200 || status >= 300) {
      throw new Error(`pull responded ${status}`);
    }
    const trimmed = body.trimStart();
    return parseOverlay(
      trimmed.startsWith('{') || trimmed.startsWith('[')
        ? { kind: 'json', content: body }
        : { kind: 'yaml', content: body },
    );
  }

  /** Where the last-good bundle is kept, for messages: an injected store (a Worker's KV) has no file path. */
  private cacheLocation(): string {
    return this.deps.cache ? 'in the injected bundle cache' : `at ${this.cachePath()}`;
  }

  private cachePath(): string {
    const dir = this.cacheDir ?? DEFAULT_CACHE_DIR;
    return pathResolve(dir, `${this.options.expectedAudience.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`);
  }

  private async persistCache(bundle: ResolvedBundle): Promise<void> {
    try {
      // Injected cache (e.g. KV on Cloudflare) wins — no filesystem on edge.
      if (this.deps.cache) {
        await this.deps.cache.write(bundle);
        return;
      }
      const filePath = this.cachePath();
      await ensureDir(dirname(filePath));
      await writeFile(filePath, JSON.stringify(bundle));
    } catch (e) {
      this.logger.warn(`[saas-source] cache persist failed: ${(e as Error).message}`);
    }
  }

  private async loadCache(): Promise<ResolvedBundle | undefined> {
    try {
      if (this.deps.cache) {
        const cached = await this.deps.cache.read();
        if (cached === undefined || cached === null) return undefined;
        // Validate the injected-cache result through the SAME schema gate the
        // disk path uses (parseOverlay → resolvedBundleSchema + crossValidate),
        // so a corrupt/tampered KV entry can't bypass validation and be applied.
        return parseOverlay({ kind: 'object', content: cached });
      }
      const filePath = this.cachePath();
      const raw = await readFile(filePath, 'utf8');
      return parseOverlay({ kind: 'json', content: raw });
    } catch {
      return undefined;
    }
  }

  private async notify(bundle: ResolvedBundle, origin?: BundleOrigin): Promise<void> {
    for (const fn of this.listeners) {
      try {
        await fn(bundle, origin);
      } catch (e) {
        this.logger.warn(`[saas-source] listener threw: ${(e as Error).message}`);
      }
    }
  }

  private notifyPullFailure(reason: string, tokenFailure: BundleTokenFailure | undefined): void {
    for (const listener of this.pullFailureListeners) {
      try {
        listener(reason, tokenFailure);
      } catch (e) {
        this.logger.warn(`[saas-source] pull failure listener threw: ${(e as Error).message}`);
      }
    }
  }
}
