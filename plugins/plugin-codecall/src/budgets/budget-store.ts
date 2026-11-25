import type { OnShutdown, Reference } from '@frontmcp/sdk';
import { randomUUID, sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import type { CodeCallBudget } from '../codecall.types';

/** A budget the caller reached the limit of, and the seconds until its window ends. */
export interface ExceededBudget {
  budget: CodeCallBudget;
  resetsInSeconds: number;
}

/** One call counted against the caller's `toolCalls` budgets at once, and the budgets that leaves it over. */
export interface CallReservation {
  exceeded: ExceededBudget[];
  /** Takes the call back off its `toolCalls` budgets, once; rejects when a count could not be taken back. */
  release(): Promise<void>;
}

/** Each caller's counts in shared storage: one key per budget, caller and fixed window, kept for at least the window. */
export class CodeCallBudgetStore implements OnShutdown {
  constructor(
    private readonly storage: NamespacedStorage,
    readonly budgets: readonly CodeCallBudget[],
    private readonly now: () => number = Date.now,
  ) {}

  /** The budgets the caller reached in their windows. */
  async exceededOf(caller: string): Promise<ExceededBudget[]> {
    const nowSeconds = this.now() / 1000;
    const stored = await this.storage.mget(this.budgets.map((budget) => this.keyOf(budget, caller, nowSeconds)));
    return this.budgets
      .filter((budget, position) => isReached(stored[position], budget.limit))
      .map((budget) => exceededAt(budget, nowSeconds));
  }

  /** Counts one call against the caller's `toolCalls` budgets with an atomic increment each, and reads the others. */
  async reserveCall(caller: string): Promise<CallReservation> {
    const nowSeconds = this.now() / 1000;
    const reservedKeys: string[] = [];
    const release = async () => {
      const results = await Promise.allSettled(reservedKeys.splice(0).map((key) => this.storage.incrBy(key, -1)));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    };
    const exceeded: ExceededBudget[] = [];
    try {
      for (const budget of this.budgets) {
        const key = this.keyOf(budget, caller, nowSeconds);
        if (budget.counts === 'recordsChanged') {
          if (isReached(await this.storage.get(key), budget.limit)) exceeded.push(exceededAt(budget, nowSeconds));
          continue;
        }
        const countWithCall = await this.storage.incrBy(key, 1);
        reservedKeys.push(key);
        await this.storage.extendTtl(key, budget.windowSeconds);
        if (countWithCall <= budget.limit) continue;
        exceeded.push(exceededAt(budget, nowSeconds));
        if (budget.onExceeded === 'denied') {
          await release();
          break;
        }
      }
    } catch (error: unknown) {
      await release();
      throw error;
    }
    return { exceeded, release };
  }

  /** Adds the records a call changed to the caller's `recordsChanged` budgets. */
  async addRecords(caller: string, count: number): Promise<void> {
    const nowSeconds = this.now() / 1000;
    const counting = this.budgets.filter((budget) => budget.counts === 'recordsChanged');
    await Promise.all(
      counting.map(async (budget) => {
        const key = this.keyOf(budget, caller, nowSeconds);
        await this.storage.incrBy(key, count);
        await this.storage.extendTtl(key, budget.windowSeconds);
      }),
    );
  }

  /** Whether a call already spent the grant named `grantKey`. */
  async isSpent(grantKey: string): Promise<boolean> {
    return this.storage.exists(spentKeyOf(grantKey));
  }

  /** Spends a grant that counts until `countsUntil` (epoch ms): the claimant, for the one claim that marked it first. */
  async claim(grantKey: string, countsUntil: number): Promise<string | undefined> {
    const ttlSeconds = Math.ceil((countsUntil - this.now()) / 1000);
    if (ttlSeconds <= 0) return undefined;
    const key = spentKeyOf(grantKey);
    const claimant = randomUUID();
    await this.storage.set(key, claimant, { ttlSeconds, ifNotExists: true });
    return (await this.storage.get(key)) === claimant ? claimant : undefined;
  }

  /** Gives back a grant its claimant spent, while the marker is still that claimant's. */
  async release(grantKey: string, claimant: string): Promise<void> {
    await this.storage.deleteIfEquals(spentKeyOf(grantKey), claimant);
  }

  async onShutdown(): Promise<void> {
    await this.storage.disconnect();
  }

  /** The caller is hashed: a subject or session id never appears in a key. */
  private keyOf(budget: CodeCallBudget, caller: string, nowSeconds: number): string {
    return `${budget.name}:${sha256Hex(caller)}:${windowStartOf(budget, nowSeconds)}`;
  }
}

/** A `.` keeps the marker apart from every budget's keys, whose names have none. */
function spentKeyOf(grantKey: string): string {
  return `grant.spent:${sha256Hex(grantKey)}`;
}

/** Whether a stored count reached the limit; one that is not a number counts as reached. */
function isReached(stored: string | null | undefined, limit: number): boolean {
  const used = Number(stored ?? 0);
  return Number.isNaN(used) || used >= limit;
}

function exceededAt(budget: CodeCallBudget, nowSeconds: number): ExceededBudget {
  const windowEnd = windowStartOf(budget, nowSeconds) + budget.windowSeconds;
  return { budget, resetsInSeconds: Math.ceil(windowEnd - nowSeconds) };
}

function windowStartOf(budget: CodeCallBudget, nowSeconds: number): number {
  return Math.floor(nowSeconds / budget.windowSeconds) * budget.windowSeconds;
}

/** The store of budget counts: `this.get(CodeCallBudgetStoreToken)`, registered while `budgets` is set. */
export const CodeCallBudgetStoreToken = Symbol('plugin:codecall:budgets') as Reference<CodeCallBudgetStore>;
