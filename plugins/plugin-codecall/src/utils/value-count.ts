// file: plugins/plugin-codecall/src/utils/value-count.ts

/**
 * The array items and object keys of a value at every depth, as the sandbox counts a tool result against
 * `vm.maxSanitizeProperties`. An object reached twice is counted once, so the count is never above the sandbox's.
 */
export function countResultValues(value: unknown): number {
  const visited = new WeakSet<object>();
  const pending: unknown[] = [value];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const children = Array.isArray(current) ? current : Object.values(current);
    count += Array.isArray(current) ? current.length : Object.keys(current).length;
    for (const child of children) {
      pending.push(child);
    }
  }
  return count;
}
