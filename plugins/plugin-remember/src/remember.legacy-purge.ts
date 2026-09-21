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
 * How long the fleet must have been on the `v2:` layout before anything is deleted.
 *
 * An instance that starts mid-rollout shares the store with the instances it is replacing, and
 * those still read and write the legacy prefixes — the `v2:` segment protects this version's
 * data, not theirs. A day is far longer than any rollout, and longer than the window in which
 * a bad deploy gets rolled back, which is the case that matters: a rollback after the sweep
 * makes the old fleet permanent again with its memory already gone.
 *
 * Waiting costs nothing. The entries are unreadable either way.
 */
const DEFAULT_LEGACY_PURGE_DELAY_MS = 86_400_000;

/**
 * Key recording when the `v2:` layout was first seen on this store.
 *
 * Deliberately outside every scope prefix, so no purge pattern can match it and no accessor
 * scope can collide with it.
 */
const LAYOUT_MARKER_KEY = '__layout__';

/** The layout this version of the plugin writes. */
const LAYOUT_VERSION = 2;

/** `setTimeout` overflows past this and fires immediately, so long waits are served in chunks. */
const MAX_TIMER_MS = 2_147_483_647;

interface LayoutMarker {
  version: number;
  firstSeenAt: number;
}

/** Stores whose sweep is already armed, so it is scheduled once per store. */
const scheduled = new WeakSet<RememberStoreInterface>();

/** Read a marker's timestamp, or `undefined` if it is missing or unparseable. */
function parseFirstSeenAt(raw: unknown): number | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const firstSeenAt = (parsed as LayoutMarker | null)?.firstSeenAt;
    return typeof firstSeenAt === 'number' && Number.isFinite(firstSeenAt) ? firstSeenAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * When the first instance on this layout reached this store.
 *
 * The clock has to live in the store, not in the process. A process-local timer restarts on
 * every deploy and every crash, so it never converges on "the fleet has been on `v2:` for a
 * while" — and an instance that booted early would fire on its own schedule no matter when the
 * last old instance drained.
 *
 * The marker is created with a conditional write, so instances booting together settle on one
 * timestamp rather than each overwriting the last. Where the store cannot express that, the
 * fallback is read-then-write, and concurrent first boots can move `firstSeenAt` forward by the
 * width of that race — immaterial against a window measured in hours, but not a guarantee.
 *
 * `undefined` means the clock could not be established, and the caller must not delete anything
 * on it.
 */
export async function readLayoutFirstSeenAt(
  store: RememberStoreInterface,
  keyPrefix: string,
  logger?: Pick<FrontMcpLogger, 'warn' | 'debug'>,
): Promise<number | undefined> {
  const key = `${keyPrefix}${LAYOUT_MARKER_KEY}`;
  const standDown = (reason: string, extra: Record<string, unknown> = {}): undefined => {
    logger?.debug?.(`remember: ${reason}, legacy purge stood down`, { key, ...extra });
    return undefined;
  };

  try {
    const existing = await store.getValue<string>(key);
    if (existing) {
      return parseFirstSeenAt(existing) ?? standDown('layout marker is unreadable');
    }

    const marker: LayoutMarker = { version: LAYOUT_VERSION, firstSeenAt: Date.now() };
    const serialized = JSON.stringify(marker);

    if (!store.setIfAbsent) {
      await store.setValue(key, serialized);
      return marker.firstSeenAt;
    }

    if (await store.setIfAbsent(key, serialized)) {
      return marker.firstSeenAt;
    }

    // Another instance created it first. Its timestamp is the fleet's, not ours.
    const winner = await store.getValue<string>(key);
    return parseFirstSeenAt(winner) ?? standDown('layout marker vanished after a lost race');
  } catch (error) {
    return standDown('could not establish the layout marker', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
 * The timer only decides — it sweeps when the fleet-wide clock has run out, and otherwise
 * re-arms for the remainder, so a restart costs time already served rather than resetting it.
 */
export function scheduleLegacyRememberPurge(
  store: RememberStoreInterface,
  keyPrefix: string,
  options: { delayMs?: number; logger?: Pick<FrontMcpLogger, 'warn' | 'debug'> } = {},
): void {
  if (scheduled.has(store)) return;
  scheduled.add(store);

  const delayMs = options.delayMs ?? DEFAULT_LEGACY_PURGE_DELAY_MS;

  const arm = (waitMs: number): void => {
    // `setTimeout` silently fires immediately past the 32-bit limit, so a very long window is
    // served in chunks; each wake re-reads the marker, so chunking is just a longer sleep.
    const timer = setTimeout(
      () => {
        void attempt().catch(() => undefined);
      },
      Math.min(waitMs, MAX_TIMER_MS),
    );

    // Housekeeping must never hold the process open. Optional because the Web timer an edge
    // runtime returns has no unref; there the invocation usually ends before the timer fires
    // and nothing is purged, which is the safe outcome.
    timer.unref?.();
  };

  const attempt = async (): Promise<void> => {
    const firstSeenAt = await readLayoutFirstSeenAt(store, keyPrefix, options.logger);
    if (firstSeenAt === undefined) return;

    const remainingMs = firstSeenAt + delayMs - Date.now();
    if (remainingMs > 0) {
      arm(remainingMs);
      return;
    }

    await purgeLegacyRememberEntries(store, keyPrefix, options.logger);
  };

  // Stamp the marker now rather than when the timer fires, so the window starts at the moment
  // this layout reached the store. Not awaited — it is one small read, off the request path.
  void attempt().catch(() => undefined);
}

/** Test seam: forget which stores have a sweep armed. */
export function resetLegacyPurgeStateForTests(store: RememberStoreInterface): void {
  scheduled.delete(store);
}
