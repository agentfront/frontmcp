import type { OnShutdown, Reference } from '@frontmcp/sdk';
import { sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import type { CodeCallBudget } from '../codecall.types';

/** What one call used, by what a budget counts. */
export type BudgetUsage = Record<CodeCallBudget['counts'], number>;

/** A budget the caller reached the limit of, and the seconds until its window ends. */
export interface ExceededBudget {
  budget: CodeCallBudget;
  resetsInSeconds: number;
}

/** Each caller's counts in shared storage: one key per budget, caller and fixed window, kept for at least the window. */
export class CodeCallBudgetStore implements OnShutdown {
  constructor(
    private readonly storage: NamespacedStorage,
    readonly budgets: readonly CodeCallBudget[],
    private readonly now: () => number = Date.now,
  ) {}

  /** The budgets the caller reached in their windows; a stored count that is not a number counts as reached. */
  async exceededOf(caller: string): Promise<ExceededBudget[]> {
    const nowSeconds = this.now() / 1000;
    const stored = await this.storage.mget(this.budgets.map((budget) => this.keyOf(budget, caller, nowSeconds)));
    return this.budgets
      .filter((budget, position) => {
        const used = Number(stored[position] ?? 0);
        return Number.isNaN(used) || used >= budget.limit;
      })
      .map((budget) => {
        const windowEnd = windowStartOf(budget, nowSeconds) + budget.windowSeconds;
        return { budget, resetsInSeconds: Math.ceil(windowEnd - nowSeconds) };
      });
  }

  /** Adds what one call used to the caller's budgets that count it. */
  async add(caller: string, usage: BudgetUsage): Promise<void> {
    const nowSeconds = this.now() / 1000;
    const counted = this.budgets.filter((budget) => usage[budget.counts] > 0);
    await Promise.all(
      counted.map(async (budget) => {
        const key = this.keyOf(budget, caller, nowSeconds);
        await this.storage.incrBy(key, usage[budget.counts]);
        await this.storage.extendTtl(key, budget.windowSeconds);
      }),
    );
  }

  async onShutdown(): Promise<void> {
    await this.storage.disconnect();
  }

  /** The caller is hashed: a subject or session id never appears in a key. */
  private keyOf(budget: CodeCallBudget, caller: string, nowSeconds: number): string {
    return `${budget.name}:${sha256Hex(caller)}:${windowStartOf(budget, nowSeconds)}`;
  }
}

function windowStartOf(budget: CodeCallBudget, nowSeconds: number): number {
  return Math.floor(nowSeconds / budget.windowSeconds) * budget.windowSeconds;
}

/** The store of budget counts: `this.get(CodeCallBudgetStoreToken)`, registered while `budgets` is set. */
export const CodeCallBudgetStoreToken = Symbol('plugin:codecall:budgets') as Reference<CodeCallBudgetStore>;
