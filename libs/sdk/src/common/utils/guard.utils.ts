import { isAnonymousSubject } from '@frontmcp/auth';
import {
  ConcurrencyLimitError,
  type ConcurrencyConfig,
  type GuardManager,
  type PartitionKeyContext,
  type SemaphoreTicket,
} from '@frontmcp/guard';

/**
 * Context-store key the `http:request` flow sets once it has checked `throttle.global`
 * for a request, so the tool and agent flows don't count the same request again.
 */
export const GLOBAL_RATE_LIMIT_CHECKED = Symbol.for('frontmcp:guard:global-rate-limit-checked');

/**
 * The request identity a guard partition is resolved from.
 */
export interface PartitionSource {
  sessionId: string;
  metadata?: { clientIp?: string };
  authInfo?: { clientId?: unknown };
}

/**
 * The guard partition context for a request.
 *
 * A per-request placeholder session (`anon:…`, given to requests that carry no session,
 * including every MCP 2026-07-28 request) is not a session: keying on it would give each
 * request a fresh budget. Such requests fall back to the signed-in user, or to one shared
 * `anonymous` partition. An anonymous subject is never a user id.
 */
export function buildPartitionContext(source: PartitionSource | undefined): PartitionKeyContext | undefined {
  if (!source) return undefined;
  const clientId = source.authInfo?.clientId;
  const userId = isAnonymousSubject(clientId) ? undefined : String(clientId);
  const hasSession = !source.sessionId.startsWith('anon:');
  const callerKey = userId ? `user:${userId}` : 'anonymous';
  return {
    sessionId: hasSession ? source.sessionId : callerKey,
    clientIp: source.metadata?.clientIp,
    userId,
  };
}

/**
 * Take a slot from `throttle.globalConcurrency` and from the entity's own limit (its
 * `concurrency`, else `throttle.defaultConcurrency`).
 *
 * @returns One ticket that releases every slot taken, or undefined when no limit applies
 * @throws ConcurrencyLimitError when a limit is full, QueueTimeoutError when queueing timed out
 */
export async function acquireConcurrencySlots(
  manager: GuardManager,
  entityName: string,
  entityConfig: ConcurrencyConfig | undefined,
  partitionContext: PartitionKeyContext | undefined,
): Promise<SemaphoreTicket | undefined> {
  const globalConfig = manager.config.globalConcurrency;
  const globalTicket = await manager.acquireGlobalSemaphore(partitionContext);
  if (globalConfig && !globalTicket) {
    throw new ConcurrencyLimitError('global', globalConfig.maxConcurrent);
  }

  const config = entityConfig ?? manager.config.defaultConcurrency;
  if (!config) return globalTicket ?? undefined;

  let entityTicket: SemaphoreTicket | null;
  try {
    entityTicket = await manager.acquireSemaphore(entityName, config, partitionContext);
  } catch (error) {
    await globalTicket?.release();
    throw error;
  }
  if (!entityTicket) {
    await globalTicket?.release();
    throw new ConcurrencyLimitError(entityName, config.maxConcurrent);
  }
  if (!globalTicket) return entityTicket;

  const heldEntityTicket = entityTicket;
  return {
    ticket: heldEntityTicket.ticket,
    release: async () => {
      await heldEntityTicket.release();
      await globalTicket.release();
    },
  };
}
