// file: plugins/plugin-skilled-openapi/src/sources/skill-bundle-source.interface.ts

import type { TokenVerifyFailure } from '@frontmcp/auth';

import type { ResolvedBundle } from '../bundle/bundle.types';
import type { ReplayNonceStore } from '../security/replay-nonce-store';

/**
 * Pluggable source of skill bundles. Static, npm-installed, and SaaS-pull
 * implementations all conform to this interface.
 *
 * Lifecycle:
 *   - `start()` is called once when the plugin is ready. The source performs
 *     its initial fetch and begins any background polling/watching.
 *   - `onChange()` registers a listener invoked every time a new bundle is
 *     available (initial fetch + every refresh).
 *   - `keepBundle()`, on a source with a last-good cache, keeps a bundle once
 *     the plugin has applied it.
 *   - `stop()` halts all background work and releases resources.
 *
 * Sources are responsible for parsing/validating their input into a
 * ResolvedBundle (typically by calling `parseOverlay` from bundle/overlay-parser).
 * They MUST NOT verify signatures themselves — the bundle-sync service applies
 * the signature gate before swapping the bundle into the registry. For the same
 * reason they never cache a bundle they fetched until they are asked to keep it.
 */
export interface SkillBundleSource {
  /** Stable id of this source (e.g. 'static:/path/to/bundle.yaml'). */
  readonly id: string;

  /**
   * Begin operation. Must perform an initial fetch and notify listeners
   * before resolving. Must throw if the initial fetch fails AND no fallback
   * (e.g. cached bundle on disk for SaaS sources) is available.
   */
  start(): Promise<void>;

  /**
   * Subscribe to bundle updates. Returns an unsubscribe function. The first
   * notification fires on or shortly after `start()` resolves.
   */
  onChange(listener: BundleSourceListener): () => void;

  /**
   * Subscribe to the pulls that fail in the background (a poll), which no caller sees: `start()` and `refresh()` throw
   * theirs. Returns an unsubscribe function. Present on a polling source: the `saas` source.
   */
  onPullFailure?(listener: BundlePullFailureListener): () => void;

  /**
   * Pull a fresh bundle on demand and notify listeners — the manual,
   * externally-driven counterpart to background polling. Optional: only
   * remote/pulling sources implement it. On runtimes with no background
   * execution (Cloudflare Workers) a Cron Trigger / Durable Object alarm
   * calls this instead of relying on an internal timer. Resolves to the new
   * bundle once its listeners are done with it (the plugin has applied it, or
   * refused it), or to `undefined` if a pull is already in flight / the source
   * is stopped.
   */
  refresh?(): Promise<ResolvedBundle | undefined>;

  /**
   * Keep a bundle the plugin applied as the last good one, which a start that can't fetch falls back to. Present on
   * a source with a last-good cache: the `saas` source.
   */
  keepBundle?(bundle: ResolvedBundle): Promise<void>;

  /** Present on a source that takes pushed bundles: the `saas` source with `enableWebhook`. */
  readonly push?: BundlePushReceiver;

  /**
   * True on a source whose bundles only move forward: the `saas` source, unless `allowRollback`. The plugin then
   * refuses a bundle older than the one being served, as `compareBundleVersions` orders them.
   */
  readonly forwardOnly?: boolean;

  /** Halt background work; idempotent. */
  stop(): Promise<void>;
}

/** The check a pushed bundle's token passes before the bundle is applied. */
export interface BundlePushReceiver {
  /**
   * Resolves when the push token is accepted for `body`, the exact bytes of the request body; throws when it is
   * refused or can't be checked.
   */
  verifyPushToken(token: string, body: Uint8Array): Promise<void>;
}

/** Takes each new bundle; a pulling source waits for a promise it returns before its pull counts as done. */
export type BundleSourceListener = (bundle: ResolvedBundle, origin?: BundleOrigin) => unknown;

/** How a source came by a bundle it hands its listeners. */
export interface BundleOrigin {
  /** Set when the pull failed and the bundle is the last good one the source kept, served in its place: why it failed. */
  pullFailure?: string;
  /** Set when that pull failed on its token: the check that refused it, or `jwks_unavailable`. */
  tokenFailure?: BundleTokenFailure;
}

/**
 * Which check refused a pull or push token, or `jwks_unavailable` when the issuer's keys could not be read to check
 * it; `body_mismatch` is a push token issued for another body. For the server's logs and `/readyz`: a caller learns
 * only that its token was refused.
 */
export type BundleTokenFailure = TokenVerifyFailure | 'wrong_audience' | 'body_mismatch';

/** Takes the reason a background pull failed, and the token check it failed on, if any. */
export type BundlePullFailureListener = (reason: string, tokenFailure?: BundleTokenFailure) => void;

/**
 * Pluggable last-good bundle cache. The default (Node) implementation writes to
 * disk; V8-isolate runtimes (Cloudflare Workers) inject a KV-backed store
 * instead — there is no filesystem on a Worker.
 */
export interface BundleCacheStore {
  read(): Promise<ResolvedBundle | undefined>;
  write(bundle: ResolvedBundle): Promise<void>;
}

/**
 * Optional runtime dependencies any pulling bundle source can accept. NOT
 * SaaS-specific — these are the knobs a host injects to make a source run on a
 * constrained runtime:
 *   - `cache` replaces the on-disk last-good cache (no filesystem on a Worker),
 *   - `disablePolling` turns off the internal `setInterval` loop (no background
 *     execution on a Worker; a Cron Trigger / DO alarm drives {@link
 *     SkillBundleSource.refresh} instead),
 *   - `pushReplayStore` records the pushed tokens' `jti`s where every instance
 *     reaches them (a Durable Object on a Worker).
 */
export interface BundleSourceDeps {
  /**
   * Override the on-disk cache with a custom store (e.g. KV on Cloudflare).
   * When provided, NO filesystem APIs are touched — required on V8 isolates.
   */
  cache?: BundleCacheStore;
  /**
   * Disable the internal `setInterval` poll loop. Use on runtimes with no
   * background execution where a Cron Trigger / Durable Object alarm drives
   * {@link SkillBundleSource.refresh} instead.
   */
  disablePolling?: boolean;
  /**
   * Where the push replay guard records the `jti`s it accepted, shared by every instance that serves the server.
   * Replaces the `saas` source's `pushReplayStorage` option and its in-memory default.
   */
  pushReplayStore?: ReplayNonceStore;
}
