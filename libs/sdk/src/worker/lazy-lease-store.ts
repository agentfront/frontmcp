import { type RootStorage, type SetOptions, type StorageConfig } from '@frontmcp/utils';

import { describeThrown } from '../duty/describe-thrown';
import type { LeaseStorage } from '../duty/lease-holder';
import { openLeaseStore } from '../duty/lease-store';

/** A lease store opened at its first use, and again at the next one after an open failed, as the next lease check. */
export class LazyLeaseStore implements LeaseStorage {
  /** Why the store could not be opened at the last try; undefined once it is open. */
  openFailure?: string;
  private opened?: Promise<RootStorage>;

  /** Takes where the store lives. */
  constructor(private readonly config: StorageConfig) {}

  /** Write `key` in the store, once it is open. */
  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    await (await this.open()).set(key, value, options);
  }

  /** Extend `key` while it holds `expectedValue`, once the store is open. */
  async expireIfEquals(key: string, expectedValue: string, ttlSeconds: number): Promise<boolean> {
    return (await this.open()).expireIfEquals(key, expectedValue, ttlSeconds);
  }

  /** Delete `key` while it holds `expectedValue`, once the store is open. */
  async deleteIfEquals(key: string, expectedValue: string): Promise<boolean> {
    return (await this.open()).deleteIfEquals(key, expectedValue);
  }

  /** Close the store, if it was opened. */
  async disconnect(): Promise<void> {
    const storage = await this.opened?.catch(() => undefined);
    await storage?.disconnect();
  }

  /** The open store, opening it unless an open is under way or done. */
  private open(): Promise<RootStorage> {
    this.opened ??= openLeaseStore(this.config).then(
      (storage) => {
        this.openFailure = undefined;
        return storage;
      },
      (error: unknown) => {
        this.opened = undefined;
        this.openFailure = describeThrown(error);
        throw error;
      },
    );
    return this.opened;
  }
}
