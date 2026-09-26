/** Entries `resolveHookOwnerId` found, handed once to the same run's find stage when the lookup key still matches. */
export class ResolvedEntries<Entry> {
  private readonly byInput = new WeakMap<object, { key: string; entry: Entry }>();

  /** Keep the entry resolved for this run's raw input and lookup key. */
  remember(rawInput: unknown, key: string, entry: Entry): void {
    if (typeof rawInput === 'object' && rawInput !== null) this.byInput.set(rawInput, { key, entry });
  }

  /** The entry kept for this run when it was resolved from the same key; undefined otherwise. */
  take(rawInput: unknown, key: string): Entry | undefined {
    if (typeof rawInput !== 'object' || rawInput === null) return undefined;
    const resolved = this.byInput.get(rawInput);
    this.byInput.delete(rawInput);
    return resolved?.key === key ? resolved.entry : undefined;
  }
}
