/**
 * Diff helpers for `AppRemoteInstance` refresh-time capability reconciliation.
 *
 * When the remote MCP server re-advertises its capability set on each
 * refresh, we track a `previous` snapshot of `qualifiedName → Token`
 * entries per kind (tools/resources/prompts). Comparing the previous and
 * `next` snapshots produces two lists:
 *
 *   - `added`: present in `next`, absent in `previous` — fresh entries
 *     that just need to be registered (idempotent if re-registering).
 *   - `removed`: present in `previous`, absent in `next` — admin-side
 *     deletions (or renames) that should be unregistered from the local
 *     registry so callers stop seeing a phantom tool.
 *
 * Extracted to its own module so the diff math stays unit-testable
 * without spinning up the full remote-app instance.
 */

/**
 * Entries present in `previous` but missing from `next`. Preserves
 * insertion order of `previous` for deterministic unregister sequence.
 */
export function diffRemoved<V>(previous: Map<string, V>, next: Map<string, V>): Array<[string, V]> {
  const out: Array<[string, V]> = [];
  for (const [key, value] of previous) {
    if (!next.has(key)) out.push([key, value]);
  }
  return out;
}

/**
 * Entries present in `next` but missing from `previous`. Preserves
 * insertion order of `next`. Useful for dry-run reporting; the caller
 * typically just re-registers everything in `next` unconditionally since
 * `register*Instance` is idempotent by token.
 */
export function diffAdded<V>(previous: Map<string, V>, next: Map<string, V>): Array<[string, V]> {
  const out: Array<[string, V]> = [];
  for (const [key, value] of next) {
    if (!previous.has(key)) out.push([key, value]);
  }
  return out;
}
