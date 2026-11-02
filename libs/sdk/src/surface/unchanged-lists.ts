let depth = 0;

/**
 * Run `change`, a registry change that leaves every list as clients see it, such as a lazy app's placeholders
 * replaced by its own entries. The registries' change events still fire; nothing announces a `list_changed` for them.
 */
export function keepingListsUnchanged<T>(change: () => T): T {
  depth++;
  try {
    return change();
  } finally {
    depth--;
  }
}

/** Whether the registry change being reported leaves every list as clients see it. */
export function listsUnchanged(): boolean {
  return depth > 0;
}
