import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { RememberStoreInterface } from './providers/remember-store.interface';

/**
 * Scopes whose storage location changed and whose entries can therefore no longer be read.
 *
 * `session` and `tool` changed twice: their encryption key now mixes in the server secret
 * (GHSA-h6f4-jg8x-38gj), and their namespace component is now encoded
 * (GHSA-225p-f8jh-f3rh). `user` changed only in the namespace, and only for identities
 * containing a character `encodeURIComponent` escapes — but a stale `user:` entry is just as
 * unreadable, so it is purged on the same pass.
 *
 * The patterns built from these names match only pre-fix keys, because the accessor now writes
 * these scopes under a `v2:` segment: `remember:session:*` cannot match `remember:v2:session:*`.
 * That separation is what makes an automatic purge safe — it can never reach a live entry, not
 * even one written concurrently by another instance running this version.
 */
const LEGACY_SCOPES = ['session', 'tool', 'user'] as const;

/**
 * How long after start the sweep waits before deleting anything.
 *
 * An instance that starts mid-rollout shares the store with the instances it is replacing,
 * and those still read and write the legacy prefixes — the `v2:` segment protects this
 * version's data, not theirs. Waiting out a normal rolling deploy is what keeps an automatic
 * purge from deleting memory another instance is still serving.
 */
const DEFAULT_LEGACY_PURGE_DELAY_MS = 600_000;

/** Stores whose sweep is already armed, so it is scheduled once per store. */
const scheduled = new WeakSet<RememberStoreInterface>();

/**
 * Delete entries that the key-derivation and namespace-encoding changes orphaned.
 *
 * Without this, `decryptValue` turns the authentication failure into `null` and a moved key
 * simply misses — the memory reads as absent with no signal at all. Deleting it makes the
 * upgrade explicit, and the warning says how much went.
 */
export async function purgeLegacyRememberEntries(
  store: RememberStoreInterface,
  keyPrefix: string,
  logger?: Pick<FrontMcpLogger, 'warn' | 'debug'>,
): Promise<number> {
  let deleted = 0;

  for (const scope of LEGACY_SCOPES) {
    const pattern = `${keyPrefix}${scope}:*`;
    let keys: string[];
    try {
      keys = await store.keys(pattern);
    } catch (error) {
      // A store that cannot enumerate keys cannot be swept; leaving the entries is the same
      // outcome as before this purge existed, so degrade rather than fail the request.
      logger?.debug?.('remember: legacy purge skipped, store could not list keys', {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const key of keys) {
      try {
        await store.delete(key);
        deleted += 1;
      } catch {
        // Best effort — one undeletable key must not abort the sweep.
      }
    }
  }

  if (deleted > 0) {
    logger?.warn?.(
      `remember: purged ${deleted} entr${deleted === 1 ? 'y' : 'ies'} left unreadable by the ` +
        'session/tool key-derivation change and the namespace encoding. This is a one-time ' +
        'upgrade step; set skipLegacyPurge to handle the migration yourself.',
    );
  }

  return deleted;
}

/**
 * Arm the sweep for a store, at most once.
 *
 * `DynamicPlugin` exposes no startup lifecycle hook and providers are not eagerly
 * instantiated, so this is armed when the accessor is first constructed. Move it to a real
 * lifecycle hook if the SDK grows one.
 *
 * Deliberately fire-and-forget: nothing on the request path waits for three keyspace scans.
 */
export function scheduleLegacyRememberPurge(
  store: RememberStoreInterface,
  keyPrefix: string,
  options: { delayMs?: number; logger?: Pick<FrontMcpLogger, 'warn' | 'debug'> } = {},
): void {
  if (scheduled.has(store)) return;
  scheduled.add(store);

  const timer = setTimeout(() => {
    void purgeLegacyRememberEntries(store, keyPrefix, options.logger).catch(() => undefined);
  }, options.delayMs ?? DEFAULT_LEGACY_PURGE_DELAY_MS);

  // Housekeeping must never hold the process open. Optional because the Web timer an edge
  // runtime returns has no unref; there the invocation usually ends first and nothing is
  // purged, which is the safe outcome.
  timer.unref?.();
}

/** Test seam: forget which stores have a sweep armed. */
export function resetLegacyPurgeStateForTests(store: RememberStoreInterface): void {
  scheduled.delete(store);
}
