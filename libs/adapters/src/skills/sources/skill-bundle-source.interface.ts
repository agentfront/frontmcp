// file: plugins/plugin-skilled-openapi/src/sources/skill-bundle-source.interface.ts

import type { ResolvedBundle } from '../bundle/bundle.types';

/**
 * Pluggable source of skill bundles. Static, npm-installed, and SaaS-pull
 * implementations all conform to this interface.
 *
 * Lifecycle:
 *   - `start()` is called once when the plugin is ready. The source performs
 *     its initial fetch and begins any background polling/watching.
 *   - `onChange()` registers a listener invoked every time a new bundle is
 *     available (initial fetch + every refresh).
 *   - `stop()` halts all background work and releases resources.
 *
 * Sources are responsible for parsing/validating their input into a
 * ResolvedBundle (typically by calling `parseOverlay` from bundle/overlay-parser).
 * They MUST NOT verify signatures themselves — the bundle-sync service applies
 * the signature gate before swapping the bundle into the registry.
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
   * Pull a fresh bundle on demand and notify listeners — the manual,
   * externally-driven counterpart to background polling. Optional: only
   * remote/pulling sources implement it. On runtimes with no background
   * execution (Cloudflare Workers) a Cron Trigger / Durable Object alarm
   * calls this instead of relying on an internal timer. Resolves to the new
   * bundle, or `undefined` if a pull is already in flight / the source is
   * stopped.
   */
  refresh?(): Promise<ResolvedBundle | undefined>;

  /** Halt background work; idempotent. */
  stop(): Promise<void>;
}

export type BundleSourceListener = (bundle: ResolvedBundle) => void;

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
 *     SkillBundleSource.refresh} instead).
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
}
