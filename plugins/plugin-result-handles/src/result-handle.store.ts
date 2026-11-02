import { z } from '@frontmcp/lazy-zod';
import type { OnShutdown } from '@frontmcp/sdk';
import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

/** Who may read a folded answer: the session and the authenticated caller it was folded for. */
export interface ResultOwner {
  /** The verified session; undefined on a transport without sessions. */
  session?: string;
  /** The authenticated subject; undefined for an anonymous caller. */
  caller?: string;
}

const HANDLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const storedResultSchema = z.object({
  owner: z.object({ session: z.string().optional(), caller: z.string().optional() }).strict(),
  value: z.unknown(),
});

/** The caller of a tool or a hook's call: its verified session and, unless anonymous, its subject. */
export function resultOwnerOf(context: {
  tryGetContext(): { verifiedSessionId?: string } | undefined;
  auth: { isAnonymous: boolean; user: { sub?: string } };
}): ResultOwner {
  const session = context.tryGetContext()?.verifiedSessionId;
  const caller = context.auth.isAnonymous ? undefined : context.auth.user.sub;
  return { ...(session && { session }), ...(caller && { caller }) };
}

/** Folded answers, each under a random handle, readable by its owner until its TTL runs out. */
export class ResultHandleStore implements OnShutdown {
  constructor(
    private readonly storage: NamespacedStorage,
    private readonly ttlSeconds: number,
  ) {}

  /** A new handle: a random UUID, which says nothing about the answer it will hold. */
  newHandle(): string {
    return randomUUID();
  }

  /** Keep `value` under `handle` for `owner` until the TTL runs out. */
  async save(handle: string, value: unknown, owner: ResultOwner): Promise<void> {
    await this.storage.set(handle, JSON.stringify({ owner, value }), { ttlSeconds: this.ttlSeconds });
  }

  /** The value under `handle`, or undefined when it expired, never existed, or `owner` is not its owner. */
  async read(handle: string, owner: ResultOwner): Promise<{ value: unknown } | undefined> {
    if (!HANDLE.test(handle)) return undefined;
    const stored = await this.storage.get(handle);
    if (stored === null) return undefined;
    const record = storedResultSchema.safeParse(parseJson(stored));
    if (!record.success) return undefined;
    const { session, caller } = record.data.owner;
    return session === owner.session && caller === owner.caller ? { value: record.data.value } : undefined;
  }

  async onShutdown(): Promise<void> {
    await this.storage.disconnect();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
