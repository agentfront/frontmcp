import { AsyncLocalStorage } from '@frontmcp/utils';

import type { ListChangedKind } from '../common/interfaces/flow.interface';
import { listsUnchanged } from './unchanged-lists';

/** The lists whose `list_changed` a batch holds until it ends. */
export type BatchedListKind = ListChangedKind | 'skills';

/** The registries a batch announces its changed lists through once it ends: a scope's. */
export type BatchedLists = Readonly<Record<BatchedListKind, { notifyListChanged(): void }>>;

/** What the change a batch runs can tell the batch. */
export interface ListChangeBatch {
  /**
   * Every list is back as it was when the batch began, as after a rollback that undid all of the change: what the
   * batch changed so far is not announced.
   */
  listsRestored(): void;
}

interface BatchRun {
  readonly lists: object;
  readonly changed: Set<BatchedListKind>;
  readonly outer: BatchRun | undefined;
  open: boolean;
}

const runningBatches = new AsyncLocalStorage<BatchRun>();

/** The innermost open batch of `lists` the calling code runs in, if any. */
function openBatchOf(lists: object): BatchRun | undefined {
  for (let run = runningBatches.getStore(); run; run = run.outer) {
    if (run.open && run.lists === lists) return run;
  }
  return undefined;
}

/**
 * Run `change` holding the `list_changed` its registry changes send, then announce each list that changed once, also
 * when `change` throws. A batch run inside another of the same lists hands what it changed to the outer one. Changes
 * made by other code meanwhile, such as another request's, are announced as they happen.
 */
export async function runListChangeBatch<T>(
  lists: BatchedLists,
  change: (batch: ListChangeBatch) => T | Promise<T>,
): Promise<T> {
  const run: BatchRun = { lists, changed: new Set(), outer: runningBatches.getStore(), open: true };
  const batch: ListChangeBatch = { listsRestored: () => run.changed.clear() };
  try {
    return await runningBatches.run(run, () => change(batch));
  } finally {
    run.open = false;
    const enclosing = openBatchOf(lists);
    for (const kind of run.changed) {
      if (enclosing) enclosing.changed.add(kind);
      else lists[kind].notifyListChanged();
    }
  }
}

/**
 * Whether a change of the `kind` registry of `lists`, reported now, is announced to clients now: not when it leaves
 * the lists as clients see them, nor while a batch holds it, which announces it once when it ends.
 */
export function announcesListChangeNow(lists: object, kind: BatchedListKind): boolean {
  if (listsUnchanged()) return false;
  const batch = openBatchOf(lists);
  batch?.changed.add(kind);
  return batch === undefined;
}
