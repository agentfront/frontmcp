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

  /** Halt background work; idempotent. */
  stop(): Promise<void>;
}

export type BundleSourceListener = (bundle: ResolvedBundle) => void;
