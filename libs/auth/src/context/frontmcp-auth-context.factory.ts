/**
 * Factory function for building FrontMcpAuthContext instances.
 *
 * This is the recommended entry point — prefer `buildAuthContext()` over
 * directly constructing `FrontMcpAuthContextImpl`.
 */

import type { AuthoritiesClaimsMapping } from '../authorities/authorities.profiles';
import type { FrontMcpAuthContext, AuthContextPipe } from './frontmcp-auth-context';
import { FrontMcpAuthContextImpl } from './frontmcp-auth-context.impl';
import type { AuthContextSourceInfo } from './frontmcp-auth-context.impl';

/**
 * Build a {@link FrontMcpAuthContext} from raw auth information.
 *
 * When `pipes` are provided, they run in sequence after the base context is built.
 * Each pipe receives the merged JWT claims and returns custom fields that are
 * merged into the final context. Pipes can be async (for DB/Redis lookups).
 *
 * @param authInfo - Raw auth info (e.g., from MCP SDK AuthInfo, JWT payload, etc.)
 * @param claimsMapping - Optional IdP-specific claims mapping (Keycloak, Auth0, Okta, etc.)
 * @param pipes - Optional pipe functions that extract custom fields from claims
 * @returns A frozen, immutable FrontMcpAuthContext instance (with custom extensions if pipes provided)
 *
 * @example
 * ```typescript
 * // Without pipes
 * const ctx = buildAuthContext({ user: { sub: 'user-123' } });
 *
 * // With pipes
 * const ctx = await buildAuthContext(authInfo, claimsMapping, [
 *   (claims) => ({ tenantId: claims['tenantId'] as string }),
 *   async (claims) => {
 *     const plan = await db.query('SELECT plan FROM orgs WHERE id=$1', [claims['org_id']]);
 *     return { subscription: { plan: plan?.name ?? 'free', active: !!plan?.active } };
 *   },
 * ]);
 * ```
 */
export function buildAuthContext(
  authInfo: AuthContextSourceInfo,
  claimsMapping?: AuthoritiesClaimsMapping,
): FrontMcpAuthContext;
export function buildAuthContext(
  authInfo: AuthContextSourceInfo,
  claimsMapping: AuthoritiesClaimsMapping | undefined,
  pipes: AuthContextPipe[],
): Promise<FrontMcpAuthContext>;
export function buildAuthContext(
  authInfo: AuthContextSourceInfo,
  claimsMapping?: AuthoritiesClaimsMapping,
  pipes?: AuthContextPipe[],
): FrontMcpAuthContext | Promise<FrontMcpAuthContext> {
  const base = new FrontMcpAuthContextImpl(authInfo, claimsMapping);

  if (!pipes || pipes.length === 0) {
    return base;
  }

  // Run pipes and merge extensions
  return runPipes(base, pipes);
}

async function runPipes(
  base: FrontMcpAuthContextImpl,
  pipes: AuthContextPipe[],
): Promise<FrontMcpAuthContext> {
  const extensions: Record<string, unknown> = {};

  for (const pipe of pipes) {
    try {
      const result = await pipe(base.claims);
      if (result && typeof result === 'object') {
        Object.assign(extensions, result);
      }
    } catch (error) {
      // Log but don't crash — a failing pipe shouldn't block the request
      // The field will simply be undefined on the context
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[FrontMcpAuth] pipe failed: ${message}`);
    }
  }

  // Create a frozen merged object with base context + pipe extensions
  // Spread the base instance's own properties + extensions
  const merged = Object.create(Object.getPrototypeOf(base) as object) as FrontMcpAuthContextImpl;
  Object.assign(merged, base, extensions);
  return Object.freeze(merged) as FrontMcpAuthContext;
}
