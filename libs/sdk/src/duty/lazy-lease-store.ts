import { type RootStorage, type SetOptions, type StorageConfig } from '@frontmcp/utils';

import type { CronLedgerStorage } from './cron-schedule';
import { describeThrown } from './describe-thrown';
import type { DutyLeaseStorage } from './duty.runner';
import { openLeaseStore } from './lease-store';

/** A lease store opened at its first use, and again at the next one after an open failed, as the next lease check. */
export class LazyLeaseStore implements DutyLeaseStorage, CronLedgerStorage {
  /** Why the store could not be opened at the last try; undefined once it is open. */
  openFailure?: string;
  private opened?: Promise<RootStorage>;

  /** Takes where the store lives. */
  constructor(private readonly config: StorageConfig) {}

  /** Read `key` from the store, once it is open. */
  async get(key: string): Promise<string | null> {
    return (await this.open()).get(key);
  }

  /** Write `key` in the store, once it is open. */
  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    await (await this.open()).set(key, value, options);
  }

  /** Replace `key` while it holds `expectedValue`, once the store is open. */
  async setIfEquals(key: string, expectedValue: string, value: string): Promise<boolean> {
    return (await this.open()).setIfEquals(key, expectedValue, value);
  }

  /** The seconds `key` has left in the store, once it is open. */
  async ttl(key: string): Promise<number | null> {
    return (await this.open()).ttl(key);
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
