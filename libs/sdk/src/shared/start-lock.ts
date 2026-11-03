import { createStorage, randomUUID, writeFile, type NamespacedStorage, type RootStorage } from '@frontmcp/utils';

import type { SharedServerFiles } from './shared-files';

/** The store operations the lock needs; the SQLite and memory stores run each one atomically. */
export type StartLockStorage = Pick<NamespacedStorage, 'set' | 'expireIfEquals' | 'deleteIfEquals'>;

const DEFAULT_TTL_SECONDS = 10;
const OWNER_ONLY_FILE = 0o600;

/** One launcher of a key starts its server at a time: a TTL key set only when absent, renewed while held. */
export class SharedStartLock {
  private readonly lockKey: string;

  constructor(
    private readonly storage: StartLockStorage,
    key: string,
    private readonly ttlSeconds = DEFAULT_TTL_SECONDS,
    readonly holder: string = randomUUID(),
  ) {
    this.lockKey = `${key}:start`;
  }

  /** Take the lock when no other launcher holds it; `true` when this one holds it now. */
  async acquire(): Promise<boolean> {
    await this.storage.set(this.lockKey, this.holder, { ttlSeconds: this.ttlSeconds, ifNotExists: true });
    return this.renew();
  }

  /** Extend the lock while this launcher still holds it. */
  renew(): Promise<boolean> {
    return this.storage.expireIfEquals(this.lockKey, this.holder, this.ttlSeconds);
  }

  async release(): Promise<void> {
    await this.storage.deleteIfEquals(this.lockKey, this.holder);
  }
}

/** A start lock a server holds while it starts: the one its launcher took, kept even after that launcher died. */
export interface HeldStartLock {
  /** Whether it still holds the lock: taken again when it lapsed, but lost for good once another launcher took it. */
  held(): Promise<boolean>;
  release(): Promise<void>;
}

/** Hold the key's start lock for `holder` until released, renewed on a timer, so no other launcher starts a server. */
export async function holdStartLock(
  files: SharedServerFiles,
  key: string,
  holder?: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<HeldStartLock> {
  const storage = await openStartLockStorage(files);
  const lock = new SharedStartLock(storage, key, ttlSeconds, holder);
  let lost = false;
  const keep = async (): Promise<boolean> => {
    if (!lost && !(await lock.acquire())) lost = true;
    return !lost;
  };
  let renewing: Promise<unknown> = Promise.resolve();
  const renewal = setInterval(
    () => {
      renewing = keep().catch(() => undefined);
    },
    (ttlSeconds * 1_000) / 5,
  );
  renewal.unref();
  return {
    held: keep,
    release: async () => {
      clearInterval(renewal);
      await renewing;
      await lock.release().catch(() => undefined);
      await storage.disconnect();
    },
  };
}

/** The SQLite file in the key's folder every launcher of the key opens, created owner-only. */
export async function openStartLockStorage(files: SharedServerFiles): Promise<RootStorage> {
  await writeFile(files.lockFile, '', { mode: OWNER_ONLY_FILE, flag: 'a' });
  return createStorage({
    type: 'sqlite',
    sqlite: { path: files.lockFile },
    prefix: 'frontmcp:shared:',
    fallback: 'error',
  });
}
