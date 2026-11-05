import { AsyncLocalStorage } from '@frontmcp/utils';

import type { ListChangedKind } from '../common/interfaces/flow.interface';
import { listsUnchanged } from './unchanged-lists';

/** The lists whose `list_changed` a batch holds until it ends. */
export type BatchedListKind = ListChangedKind | 'skills';

/** The registries a batch announces its changed lists through once it ends: a scope's. */
export type BatchedLists = Readonly<Record<BatchedListKind, { notifyListChanged(): void }>>;

interface ListChangeBatch {
  readonly lists: object;
  readonly changed: Set<BatchedListKind>;
  readonly outer: ListChangeBatch | undefined;
  open: boolean;
}

const runningBatches = new AsyncLocalStorage<ListChangeBatch>();

/** The open batch of `lists` the calling code runs in, if any. */
function openBatchOf(lists: object): ListChangeBatch | undefined {
  for (let batch = runningBatches.getStore(); batch; batch = batch.outer) {
    if (batch.open && batch.lists === lists) return batch;
  }
  return undefined;
}

/**
 * Run `change` holding the `list_changed` its registry changes send, then announce each list that changed once, also
 * when `change` throws. A batch run inside another of the same lists joins it. Changes made by other code meanwhile,
 * such as another request's, are announced as they happen.
 */
export async function runListChangeBatch<T>(lists: BatchedLists, change: () => T | Promise<T>): Promise<T> {
  if (openBatchOf(lists)) return change();
  const batch: ListChangeBatch = { lists, changed: new Set(), outer: runningBatches.getStore(), open: true };
  try {
    return await runningBatches.run(batch, change);
  } finally {
    batch.open = false;
    for (const kind of batch.changed) lists[kind].notifyListChanged();
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
