/**
 * FrontMcpAuthContext module — FrontMCP's own auth identity type system.
 *
 * @example
 * ```typescript
 * import { buildAuthContext } from '@frontmcp/auth';
 *
 * const ctx = buildAuthContext(authInfo, { roles: 'realm_access.roles' });
 * if (ctx.hasRole('admin')) { ... }
 * ```
 */

// Interface + extension types
export type { FrontMcpAuthContext, FrontMcpAuthUser, AuthContextPipe } from './frontmcp-auth-context';

// Implementation (exported for testing; prefer buildAuthContext for production use)
export { FrontMcpAuthContextImpl } from './frontmcp-auth-context.impl';
export type { AuthContextSourceInfo } from './frontmcp-auth-context.impl';

// Factory
export { buildAuthContext } from './frontmcp-auth-context.factory';
