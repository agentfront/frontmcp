import type { RememberScope } from '../remember.types';

/**
 * The scopes the memory tools offer. `tool` scope is the memory of the tool that runs the call, so what
 * `remember_this` stored there `recall` never found: the tools leave it out.
 */
export const MEMORY_TOOL_SCOPES = ['session', 'user', 'global'] as const;

/** The scopes a memory tool accepts: `tools.allowedScopes` without `tool`, else every scope the tools offer. */
export function allowedMemoryToolScopes(allowedScopes: readonly RememberScope[] | undefined): RememberScope[] {
  return (allowedScopes ?? MEMORY_TOOL_SCOPES).filter((scope) => scope !== 'tool');
}

/**
 * What each memory scope means, for the `scope` argument of all four Remember tools.
 *
 * One text, so the tools never disagree, and one that holds on every transport: under MCP
 * 2026-07-28 and on the stateless HTTP transport there is no session, and `session` memory then
 * belongs to the signed-in caller (`RememberAccessor.resolveSessionIdentity`).
 */
export const REMEMBER_SCOPE_DESCRIPTION =
  'Whose memory to use (default: session). ' +
  'session: this session; without one (stateless HTTP, MCP 2026-07-28), the signed-in caller across its requests. ' +
  'user: the signed-in caller, across all of its sessions. ' +
  'global: shared by every caller. ' +
  'An anonymous caller cannot use user scope, nor session scope without a session.';
