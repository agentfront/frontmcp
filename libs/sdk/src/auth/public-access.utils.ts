import { isAnonymousSubject, type PublicAccessConfig } from '@frontmcp/auth';
import { type GuardManager, type PartitionKeyContext } from '@frontmcp/guard';

import { PublicAccessDeniedError, RateLimitError } from '../errors';

const PUBLIC_ACCESS_RATE_LIMIT_KEY = '__public_access__';
const PUBLIC_ACCESS_WINDOW_MS = 60_000;

/** The `publicAccess` of the auth options, for an anonymous caller; undefined when it does not restrict this caller. */
export function publicAccessFor(authOptions: unknown, authInfo: unknown): PublicAccessConfig | undefined {
  const publicAccess = (authOptions as { publicAccess?: PublicAccessConfig } | undefined)?.publicAccess;
  if (!publicAccess) return undefined;
  const info = authInfo as { user?: { sub?: unknown }; extra?: { user?: { sub?: unknown } } } | undefined;
  return isAnonymousSubject(info?.user?.sub ?? info?.extra?.user?.sub) ? publicAccess : undefined;
}

/** Whether `publicAccess` lists an entry, by any of its names (its name, or its app-qualified name). */
export function isPubliclyListed(
  publicAccess: PublicAccessConfig,
  kind: 'tools' | 'prompts',
  names: string[],
): boolean {
  const allowed = publicAccess[kind] ?? 'all';
  return allowed === 'all' || names.some((name) => allowed.includes(name));
}

/**
 * Refuses an anonymous caller an entry `publicAccess` does not list, and counts the call against
 * `publicAccess.rateLimit` (per IP, per minute) when the server has a guard manager.
 */
export async function enforcePublicAccess(
  publicAccess: PublicAccessConfig,
  entry: { kind: 'tool' | 'prompt'; names: string[] },
  guard: GuardManager | undefined,
  partition: PartitionKeyContext | undefined,
): Promise<void> {
  if (!isPubliclyListed(publicAccess, entry.kind === 'tool' ? 'tools' : 'prompts', entry.names)) {
    throw new PublicAccessDeniedError(entry.kind, entry.names[0]);
  }
  if (!guard || !publicAccess.rateLimit) return;
  const result = await guard.checkRateLimit(
    PUBLIC_ACCESS_RATE_LIMIT_KEY,
    { maxRequests: publicAccess.rateLimit, windowMs: PUBLIC_ACCESS_WINDOW_MS, partitionBy: 'ip' },
    partition,
  );
  if (!result.allowed) throw new RateLimitError(Math.ceil((result.retryAfterMs ?? PUBLIC_ACCESS_WINDOW_MS) / 1000));
}
