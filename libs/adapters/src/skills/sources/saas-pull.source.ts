// file: libs/adapters/src/skills/sources/saas-pull.source.ts

// All Node APIs route through `@frontmcp/utils` (env-aware via `#path` and
// `#fs` subpath imports + assertNode guards). The build pipeline
// (`frontmcp build --target <env>`) picks the right resolution per target.
import { JwksService, type JSONWebKeySet } from '@frontmcp/auth';
import type { FrontMcpLogger } from '@frontmcp/sdk';
import { dirname, ensureDir, isRedirectResponse, pathResolve, readFile, writeFile } from '@frontmcp/utils';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { parseOverlay } from '../bundle/overlay-parser';
import type { SaasSourceOptions } from '../source-options';
import type { BundleSourceDeps, BundleSourceListener, SkillBundleSource } from './skill-bundle-source.interface';

const DEFAULT_CACHE_DIR = '.frontmcp/skilled-openapi';
const DEFAULT_PULL_TIMEOUT_MS = 30_000;
const USER_AGENT = 'frontmcp-skilled-openapi';

/**
 * The pinned pull token failed verification against `jwksUrl`, `expectedIssuer`
 * or `expectedAudience`. Unlike an outage, this never falls back to a cached
 * bundle: the configured SaaS is not the one the server was set up to trust.
 */
export class SaasPullTokenRejectedError extends Error {
  constructor(reason: string) {
    super(`[saas-source] pull token rejected: ${reason}`);
    this.name = 'SaasPullTokenRejectedError';
  }
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
 *   - If the pull fails AND a cached bundle exists on disk, falls back to it
 *     and emits a warning. This prevents a SaaS outage at boot from killing
 *     the customer's MCP server.
 *   - If both pull and cache fail, `start()` throws.
 *
 * Refresh: poll on `pollIntervalMs`. Single-flight per source — overlapping
 * polls are skipped, never queued. Webhook support is gated behind
 * `enableWebhook` and deferred to v1.2.x (route mounting requires plugin HTTP
 * infrastructure not yet in scope).
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
 * before the bundle becomes active.
 */
export class SaasPullSource implements SkillBundleSource {
  readonly id: string;

  private listeners = new Set<BundleSourceListener>();
  private pollHandle: NodeJS.Timeout | undefined;
  private inFlight = false;
  private stopped = false;
  private readonly jwksService = new JwksService({});

  constructor(
    private readonly options: SaasSourceOptions,
    private readonly cacheDir: string | undefined,
    private readonly logger: FrontMcpLogger,
    private readonly deps: BundleSourceDeps = {},
  ) {
    this.id = `saas:${this.options.endpoint}`;
  }

  async start(): Promise<void> {
    // Participate in the single-flight guard. On edge runtimes the plugin
    // defers boot via `setImmediate(() => source.start())`; if a Cron Trigger
    // fires during cold-start and calls `refresh()` first, that pull holds
    // `inFlight` — so start() must skip its own pull (otherwise two concurrent
    // pulls + cache writes + notifies race, last-writer-wins). The check+set is
    // atomic (no await between), so it's a correct mutex in single-threaded JS.
    if (this.stopped || this.inFlight) {
      this.schedulePoll();
      return;
    }
    this.inFlight = true;
    let bundle: ResolvedBundle | undefined;
    try {
      try {
        bundle = await this.fetchOnce();
        await this.persistCache(bundle);
      } catch (e) {
        // A rejected pull token means the SaaS is not the one this server trusts:
        // serving the cached bundle would hide that, so fail instead.
        if (e instanceof SaasPullTokenRejectedError) throw e;
        this.logger.warn(
          `[saas-source] initial pull failed (${(e as Error).message}); attempting cached bundle fallback`,
        );
        bundle = await this.loadCache();
        if (!bundle) {
          throw new Error(
            `[saas-source] initial pull failed and no cached bundle is available ${this.cacheLocation()}: ${(e as Error).message}`,
            { cause: e },
          );
        }
        this.logger.warn(`[saas-source] using cached bundle "${bundle.bundleId}@${bundle.version}"`);
      }
      this.notify(bundle);
    } finally {
      this.inFlight = false;
    }
    this.schedulePoll();
  }

  onChange(listener: BundleSourceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }
    this.listeners.clear();
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
   * Manually pull a fresh bundle, persist it, and notify listeners. Drive this
   * from a Cron Trigger / Durable Object alarm on runtimes without background
   * timers (where `disablePolling` is set). Single-flight: returns `undefined`
   * if a pull is already in flight; throws if the pull itself fails (the caller
   * — e.g. a scheduled handler — decides how to surface it).
   */
  async refresh(): Promise<ResolvedBundle | undefined> {
    if (this.stopped || this.inFlight) return undefined;
    this.inFlight = true;
    try {
      const bundle = await this.fetchOnce();
      await this.persistCache(bundle);
      this.notify(bundle);
      return bundle;
    } finally {
      this.inFlight = false;
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) {
      // Skip; previous poll still running.
      this.schedulePoll();
      return;
    }
    this.inFlight = true;
    try {
      const bundle = await this.fetchOnce();
      await this.persistCache(bundle);
      this.notify(bundle);
    } catch (e) {
      if (e instanceof SaasPullTokenRejectedError) {
        this.logger.error(`[saas-source] poll refused: ${e.message}; keeping the current bundle`);
      } else {
        this.logger.warn(`[saas-source] poll failed: ${(e as Error).message}`);
      }
    } finally {
      this.inFlight = false;
      this.schedulePoll();
    }
  }

  // Indirected so tests can stub the network call.
  protected async httpGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    // Bound the request so a hung SaaS endpoint can't pin `inFlight=true`
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
   * Verify the pinned pull token against the issuer's JWKS, issuer and audience.
   * Throws {@link SaasPullTokenRejectedError} when the token is refused, and a
   * plain Error when the JWKS can't be fetched (an outage).
   */
  private async verifyPullToken(): Promise<void> {
    const { jwksUrl, expectedIssuer, expectedAudience, authToken } = this.options;
    // The JWKS is public: never send the pull token with it.
    const { status, body } = await this.httpGet(jwksUrl, { Accept: 'application/json', 'User-Agent': USER_AGENT });
    if (status < 200 || status >= 300) {
      throw new Error(`JWKS ${jwksUrl} responded ${status}`);
    }
    let jwks: JSONWebKeySet;
    try {
      jwks = JSON.parse(body) as JSONWebKeySet;
    } catch {
      throw new Error(`JWKS ${jwksUrl} is not valid JSON`);
    }
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error(`JWKS ${jwksUrl} has no keys`);
    }
    // A JWKS with no key that could verify a token says nothing about the token: treat it like an
    // unreachable JWKS (a pull failure), and keep SaasPullTokenRejectedError for a token that a
    // usable key set refuses.
    const signingKeys = (jwks.keys as unknown[]).filter(isUsableSigningKey);
    if (signingKeys.length === 0) {
      throw new Error(`JWKS ${jwksUrl} has no usable signing keys`);
    }

    const verified = await this.jwksService.verifyTransparentToken(authToken, [
      { id: 'skilled-openapi-saas', issuerUrl: expectedIssuer, jwks: { keys: signingKeys } as JSONWebKeySet },
    ]);
    if (!verified.ok || !verified.payload) {
      throw new SaasPullTokenRejectedError(
        `not a valid token from issuer "${expectedIssuer}" signed by a key in ${jwksUrl} (${verified.error ?? 'verification failed'})`,
      );
    }
    const payload = verified.payload;
    if (!claimValues(payload['aud']).includes(expectedAudience)) {
      throw new SaasPullTokenRejectedError(`its "aud" claim does not include "${expectedAudience}"`);
    }
    // RFC 8707: a token that names its resource must name this audience too.
    const resource = claimValues(payload['resource']);
    if (resource.length > 0 && !resource.includes(expectedAudience)) {
      throw new SaasPullTokenRejectedError(`its "resource" claim does not include "${expectedAudience}"`);
    }
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

  private notify(bundle: ResolvedBundle): void {
    for (const fn of this.listeners) {
      try {
        fn(bundle);
      } catch (e) {
        this.logger.warn(`[saas-source] listener threw: ${(e as Error).message}`);
      }
    }
  }
}
