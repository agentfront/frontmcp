/**
 * Availability filtering utilities.
 *
 * IMPORTANT ARCHITECTURAL NOTE:
 * Availability filtering is a **registry-level** concern, evaluated at boot time
 * against the process's runtime context (OS, runtime, deployment mode, NODE_ENV).
 *
 * This is fundamentally different from:
 * - **Authorization/auth** — request-scoped, evaluated per-session in HTTP flows
 * - **Rule-based filtering** — dynamic, policy-driven, evaluated at request time
 * - **hideFromDiscovery** — a soft hide from listing; the entry is still callable
 *
 * `availableWhen` is a hard constraint: if the runtime context doesn't match,
 * the entry is excluded from both discovery AND execution. It runs once at
 * registry initialization (boot) and the result is effectively frozen for the
 * lifetime of the process — the OS, runtime, and deployment mode don't change.
 */

import { getRuntimeContext, isEntryAvailable, type RuntimeContext, type EntryAvailability } from '@frontmcp/utils';
import type { FrontMcpLogger } from '../interfaces/logger.interface';

/**
 * Log availability filtering results for a set of entries at registry boot time.
 *
 * Called once per registry during `initialize()` → `reindex()` cycle.
 * Produces:
 *   - info:    summary line "X/Y entries available (Z filtered by availableWhen)"
 *   - verbose: per-entry detail for filtered entries
 *   - warn:    entries with empty constraint arrays (always filtered, likely a bug)
 *
 * @param registryKind - e.g. 'ToolRegistry', 'ResourceRegistry'
 * @param entries - all entries (local + adopted) with their metadata
 * @param logger - scoped logger
 */
export function logAvailabilityFiltering<T extends { name: string; metadata: { availableWhen?: EntryAvailability } }>(
  registryKind: string,
  entries: readonly T[],
  logger: FrontMcpLogger,
): void {
  const ctx = getRuntimeContext();
  const constrained: T[] = [];
  const filtered: T[] = [];
  const emptyConstraints: T[] = [];
  const fields: (keyof EntryAvailability)[] = ['platform', 'runtime', 'deployment', 'env'];

  for (const entry of entries) {
    const aw = entry.metadata.availableWhen;
    if (!aw) continue;

    constrained.push(entry);

    // Warn about empty arrays — they match nothing, likely a config bug
    for (const field of fields) {
      const arr = aw[field];
      if (arr && arr.length === 0) {
        emptyConstraints.push(entry);
        break;
      }
    }

    if (!isEntryAvailable(aw, ctx)) {
      filtered.push(entry);
    }
  }

  // No constrained entries → nothing to log
  if (constrained.length === 0) return;

  const available = constrained.length - filtered.length;

  logger.info(
    `[${registryKind}] availability: ${entries.length} total, ` +
      `${constrained.length} with availableWhen constraint, ` +
      `${available} available, ${filtered.length} filtered ` +
      `[ctx: platform=${ctx.platform}, runtime=${ctx.runtime}, deployment=${ctx.deployment}, env=${ctx.env}]`,
  );

  // Log each filtered entry at verbose level
  for (const entry of filtered) {
    const aw = entry.metadata.availableWhen;
    logger.verbose(
      `[${registryKind}] filtered: "${entry.name}" — ` +
        `constraint=${JSON.stringify(aw)}, ` +
        `current=${formatContextForConstraint(aw!, ctx)}`,
    );
  }

  // Warn about empty constraint arrays
  for (const entry of emptyConstraints) {
    const aw = entry.metadata.availableWhen;
    const emptyFields = fields.filter((f) => aw?.[f] && aw[f]!.length === 0);
    logger.warn(
      `[${registryKind}] "${entry.name}" has empty availableWhen arrays ` +
        `for [${emptyFields.join(', ')}] — this entry will never be available. ` +
        `This is likely a configuration bug.`,
    );
  }
}

/**
 * Format only the context fields that the constraint cares about,
 * for concise log messages.
 */
function formatContextForConstraint(aw: EntryAvailability, ctx: RuntimeContext): string {
  const parts: string[] = [];
  if (aw.platform) parts.push(`platform=${ctx.platform}`);
  if (aw.runtime) parts.push(`runtime=${ctx.runtime}`);
  if (aw.deployment) parts.push(`deployment=${ctx.deployment}`);
  if (aw.env) parts.push(`env=${ctx.env}`);
  return parts.join(', ');
}
