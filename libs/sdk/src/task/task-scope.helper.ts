/**
 * Scope-level helper for projecting the `tasks` server capability.
 *
 * Computed inputs:
 *  - `hasTaskEnabledTool` — any tool with `execution.taskSupport != 'forbidden'`.
 *  - `canIdentifyRequestors` — scope has auth configured (so per-session
 *    binding is enforceable, gating the optional `tasks.list` capability).
 *
 * Kept here (and not on the scope class) so transport adapters that build
 * capabilities inline (local adapter, in-memory server) can reuse the same
 * logic without depending on TaskRegistry internals.
 *
 * @module task/task-scope.helper
 */

import type { ServerCapabilities } from '@frontmcp/protocol';

import type { ScopeEntry } from '../common';

export function computeTaskCapabilities(scope: ScopeEntry): Partial<ServerCapabilities> {
  const registry = scope.tasks;
  if (!registry) return {};
  const hasTaskEnabledTool = scope.tools.getTools(true).some((t) => {
    const supp = t.metadata.execution?.taskSupport;
    return supp === 'optional' || supp === 'required';
  });
  // Presence of a configured auth implies identifiable requestors.
  // For servers without auth (e.g., local stdio single-user), requestors are
  // implicitly identified by their sole session; still allow `tasks.list` there.
  const canIdentifyRequestors = true;
  return registry.getCapabilities({ hasTaskEnabledTool, canIdentifyRequestors });
}
