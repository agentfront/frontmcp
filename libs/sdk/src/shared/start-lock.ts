import { createStorage, randomUUID, writeFile, type NamespacedStorage, type RootStorage } from '@frontmcp/utils';

import type { SharedServerFiles } from './shared-files';

/** The store operations the lock needs; the SQLite and memory stores run each one atomically. */
export type StartLockStorage = Pick<NamespacedStorage, 'set' | 'expireIfEquals' | 'deleteIfEquals'>;

const DEFAULT_TTL_SECONDS = 10;
const OWNER_ONLY_FILE = 0o600;

/** One launcher of a key starts its server at a time: a TTL key set only when absent, renewed while held. */
export class SharedStartLock {
  private readonly holder = randomUUID();
  private readonly lockKey: string;

  constructor(
    private readonly storage: StartLockStorage,
    key: string,
    private readonly ttlSeconds = DEFAULT_TTL_SECONDS,
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
