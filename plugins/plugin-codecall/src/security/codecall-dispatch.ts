// file: plugins/plugin-codecall/src/security/codecall-dispatch.ts

import { getRunningTool } from '@frontmcp/sdk';

/**
 * Marks the call context of a `tools:call-tool` run that CodeCall itself dispatched
 * (`codecall:execute`, `codecall:invoke`). A symbol, so no request a client sends can carry it.
 */
const CODECALL_DISPATCH = Symbol('frontmcp.codecall.dispatch');

/**
 * The call context CodeCall passes to `tools:call-tool`, marked as CodeCall's own dispatch. The mark
 * is not enumerable, so it never shows up when the context is logged or serialized.
 */
export function asCodeCallDispatch<T extends object>(ctx: T): T {
  return Object.defineProperty(ctx, CODECALL_DISPATCH, { value: true, enumerable: false });
}

/**
 * Whether a `tools:call-tool` run was dispatched in process rather than asked for by a client:
 * by CodeCall, by the SDK's trusted in-process dispatch (`this.callTool()` from a tool, agent or
 * job, which sets `internalCall`), or from inside a running tool. A client's own `tools/call`
 * (MCP, a widget, an in-page agent, `DirectMcpServer.callTool()`) is none of these.
 */
export function isInProcessDispatch(ctx: unknown): boolean {
  if (getRunningTool()) return true;
  if (typeof ctx !== 'object' || ctx === null) return false;
  const marks = ctx as { internalCall?: unknown; [CODECALL_DISPATCH]?: unknown };
  return marks[CODECALL_DISPATCH] === true || marks.internalCall === true;
}
