/**
 * The push replay guard's store on Cloudflare: a Durable Object.
 *
 * With `managed.enableWebhook`, a push token's `jti` may be used once. The isolates and replicas of a Worker share no
 * memory, and KV is eventually consistent (two isolates can both read a `jti` as unused), so every isolate records the
 * `jti`s in one Durable Object instance, which reads and writes them atomically.
 */

/** Minimal structural view of a Cloudflare `DurableObjectNamespace`. */
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/** The parts of a Durable Object's `state.storage` the replay object uses. */
interface PushReplayStorageLike {
  list(): Promise<Map<string, unknown>>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

/** Records each push token's `jti` once. Structurally the `ReplayNonceStore` of `@frontmcp/adapters/skills`. */
export interface EdgePushReplayStore {
  /** Resolves true when this call recorded `key`, false when it is recorded and not expired; throws on a failure. */
  claim(key: string, ttlMs: number): Promise<boolean>;
}

/** Builds the push replay store from the Worker's `env`, where Cloudflare bindings live. */
export type EdgePushReplayStoreFactory = (env: unknown) => EdgePushReplayStore | undefined;

interface ReplayClaim {
  key: string;
  ttlMs: number;
}

/** Default Durable Object binding of the push replay guard. */
export const DEFAULT_PUSH_REPLAY_BINDING = 'FRONTMCP_PUSH_REPLAY';

const CLAIM_URL = 'https://push-replay.frontmcp.internal/claim';

/** The most keys a Durable Object storage `delete()` takes at once. */
const MAX_KEYS_PER_DELETE = 128;

function readClaim(body: unknown): ReplayClaim | undefined {
  const { key, ttlMs } = (body ?? {}) as Partial<ReplayClaim>;
  if (typeof key !== 'string' || key.length === 0) return undefined;
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs < 0) return undefined;
  return { key, ttlMs };
}

function isUnexpired(expiresAt: unknown, now: number): boolean {
  return typeof expiresAt === 'number' && expiresAt >= now;
}

/**
 * The Durable Object class that keeps the push tokens' `jti`s. Export it from the Worker entry and bind it under
 * `managed.pushReplay.binding` (default `FRONTMCP_PUSH_REPLAY`). Each claim also drops the expired `jti`s.
 */
export class PushReplayDurableObject {
  private readonly storage: PushReplayStorageLike;

  constructor(state: { storage: PushReplayStorageLike }) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const claim = readClaim(await request.json().catch(() => undefined));
    if (!claim) return Response.json({ error: 'invalid_claim' }, { status: 400 });
    return Response.json({ claimed: await this.claim(claim) });
  }

  private async claim({ key, ttlMs }: ReplayClaim): Promise<boolean> {
    const now = Date.now();
    // Only storage calls are awaited from here on, so the object's input gate makes the read and the write atomic.
    const expiries = await this.storage.list();
    const expiredKeys = [...expiries].filter(([, expiresAt]) => !isUnexpired(expiresAt, now)).map(([name]) => name);
    for (let start = 0; start < expiredKeys.length; start += MAX_KEYS_PER_DELETE) {
      await this.storage.delete(expiredKeys.slice(start, start + MAX_KEYS_PER_DELETE));
    }
    if (isUnexpired(expiries.get(key), now)) return false;
    await this.storage.put(key, now + ttlMs);
    return true;
  }
}

/** A push replay store on the {@link PushReplayDurableObject} instance named `name` in `namespace`. */
export function createDurableObjectPushReplayStore(
  namespace: DurableObjectNamespaceLike,
  name: string,
): EdgePushReplayStore {
  return {
    async claim(key: string, ttlMs: number): Promise<boolean> {
      const replayObject = namespace.get(namespace.idFromName(name));
      const response = await replayObject.fetch(
        new Request(CLAIM_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, ttlMs }),
        }),
      );
      const answer = (await response.json().catch(() => undefined)) as { claimed?: unknown } | undefined;
      if (!response.ok || typeof answer?.claimed !== 'boolean') {
        throw new Error(`the push replay Durable Object answered ${response.status}`);
      }
      return answer.claimed;
    },
  };
}

function isDurableObjectNamespace(value: unknown): value is DurableObjectNamespaceLike {
  const candidate = value as Partial<DurableObjectNamespaceLike> | undefined;
  return typeof candidate?.idFromName === 'function' && typeof candidate.get === 'function';
}

/** A store that refuses every push, so a missing store is never mistaken for an unused `jti`. */
function unavailablePushReplayStore(reason: string): EdgePushReplayStore {
  return {
    async claim(): Promise<boolean> {
      throw new Error(reason);
    },
  };
}

/**
 * The push replay store `pushReplay` names, resolved against the Worker's `env`: the Durable Object bound under its
 * `binding`, or what its function returns. With neither, every push is refused.
 */
export function resolvePushReplayStore(
  pushReplay: { binding?: string } | EdgePushReplayStoreFactory | undefined,
  env: unknown,
  name: string,
): EdgePushReplayStore {
  if (typeof pushReplay === 'function') {
    return pushReplay(env) ?? unavailablePushReplayStore('the managed.pushReplay function returned no store');
  }
  const binding = pushReplay?.binding ?? DEFAULT_PUSH_REPLAY_BINDING;
  const namespace = (env as Record<string, unknown> | undefined)?.[binding];
  if (!isDurableObjectNamespace(namespace)) {
    return unavailablePushReplayStore(
      `the Durable Object binding "${binding}" is not bound: export mcp.PushReplayDurableObject and bind it in wrangler.toml`,
    );
  }
  return createDurableObjectPushReplayStore(namespace, name);
}
