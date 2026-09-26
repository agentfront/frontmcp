import { isAnonymousSubject } from '@frontmcp/auth';
import {
  ConcurrencyLimitError,
  type ConcurrencyConfig,
  type GuardManager,
  type PartitionKey,
  type PartitionKeyContext,
  type SemaphoreTicket,
} from '@frontmcp/guard';

import type { ScopeEntry } from '../entries/scope.entry';
import { FlowControl } from '../interfaces/flow.interface';
import { httpRespond, type HttpOutput } from '../schemas/http-output.schema';

/** The body a non-JSON-RPC route answers when `throttle.ipFilter` rejects the caller. */
export const IP_FILTER_REJECTION_BODY = { error: 'forbidden', message: 'Client IP rejected by ipFilter' } as const;

/** Answer 403 from the `checkIpFilter` stage every HTTP-facing flow starts with (GHSA-hwfp-xv2f-fr8g). */
export function enforceIpFilter(
  scope: Pick<ScopeEntry, 'rateLimitManager' | 'logger'>,
  clientIp: string | undefined,
  buildRejection: () => HttpOutput = () => httpRespond.forbidden({ body: { ...IP_FILTER_REJECTION_BODY } }),
): void {
  const result = scope.rateLimitManager?.checkIpFilter(clientIp);
  if (!result || result.allowed) return;

  scope.logger.warn('request rejected by ipFilter', { reason: result.reason, hasClientIp: clientIp !== undefined });
  FlowControl.respond(buildRejection());
}

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
  authInfo?: { clientId?: unknown; sessionId?: unknown; extra?: { sessionId?: unknown } };
}

/**
 * The guard partition context for a request.
 *
 * Only a session the server verified is a partition: the client picks the `mcp-session-id`
 * it sends, and a request without one gets a per-request placeholder (`anon:…`), so keying on
 * either would give each request a fresh budget. Other requests fall back to the signed-in
 * user, or to one shared `anonymous` partition. An anonymous subject is never a user id.
 */
export function buildPartitionContext(source: PartitionSource | undefined): PartitionKeyContext | undefined {
  if (!source) return undefined;
  const clientId = source.authInfo?.clientId;
  const userId = isAnonymousSubject(clientId) ? undefined : String(clientId);
  const verifiedSessionId = source.authInfo?.sessionId ?? source.authInfo?.extra?.sessionId;
  const callerKey = userId ? `user:${userId}` : 'anonymous';
  return {
    sessionId: verifiedSessionId === source.sessionId ? source.sessionId : callerKey,
    clientIp: source.metadata?.clientIp,
    userId,
  };
}

/**
 * Whether a partition is keyed on the caller's identity, which is known only once the
 * request is authorized.
 */
export function partitionsByIdentity(partitionBy: PartitionKey | undefined): boolean {
  return partitionBy === 'session' || partitionBy === 'userId' || typeof partitionBy === 'function';
}

/**
 * Take a slot from `throttle.globalConcurrency` and from the entity's own limit (its
 * `concurrency`, else `throttle.defaultConcurrency`). A nested call (`skipGlobal`) runs inside
 * its caller's global slot, so it takes only its own.
 *
 * @returns One ticket that releases every slot taken, or undefined when no limit applies
 * @throws ConcurrencyLimitError when a limit is full, QueueTimeoutError when queueing timed out
 */
export async function acquireConcurrencySlots(
  manager: GuardManager,
  entityName: string,
  entityConfig: ConcurrencyConfig | undefined,
  partitionContext: PartitionKeyContext | undefined,
  options: { skipGlobal?: boolean } = {},
): Promise<SemaphoreTicket | undefined> {
  const globalConfig = options.skipGlobal ? undefined : manager.config.globalConcurrency;
  const globalTicket = globalConfig ? await manager.acquireGlobalSemaphore(partitionContext) : null;
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
      try {
        await heldEntityTicket.release();
      } finally {
        await globalTicket.release();
      }
    },
  };
}
