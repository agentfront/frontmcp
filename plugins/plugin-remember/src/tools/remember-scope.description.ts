/**
 * What each memory scope means, for the `scope` argument of all four Remember tools.
 *
 * One text, so the tools never disagree, and one that holds on every transport: under MCP
 * 2026-07-28 and on the stateless HTTP transport there is no session, and `session` and `tool`
 * memory then belong to the signed-in caller (`RememberAccessor.resolveSessionIdentity`). The
 * `tool` scope is the memory of the tool that runs the call, so each of these tools has its own.
 */
export const REMEMBER_SCOPE_DESCRIPTION =
  'Whose memory to use (default: session). ' +
  'session: this session; without one (stateless HTTP, MCP 2026-07-28), the signed-in caller across its requests. ' +
  'user: the signed-in caller, across all of its sessions. ' +
  'tool: the tool running the call, for the same caller as session; each memory tool has its own, so the other ' +
  'memory tools do not see what one of them stores in tool scope. ' +
  'global: shared by every caller. ' +
  'An anonymous caller cannot use user scope, nor session or tool scope without a session.';
