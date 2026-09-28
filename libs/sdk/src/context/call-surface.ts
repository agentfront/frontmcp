/**
 * The surface (`availableWhen.surface`) of the call being served, tracked per async call chain.
 *
 * A flow knows the surface its call arrived on from its handler context, but code that runs inside
 * the entry it serves (a tool's `execute()`, a resource's read, a completer) does not see that
 * context. Anything that acts for the caller from there (CodeCall running tools, a skill listing
 * resource, the skill tools) reads it here, so an entry the caller could not reach directly stays out
 * of reach through them.
 */
import { AsyncLocalStorage } from '@frontmcp/utils';

import { type CallSurface } from '../common/availability';

const callSurfaces = new AsyncLocalStorage<{ readonly surface: CallSurface | undefined }>();

/**
 * Run `fn` as serving a call from `surface` (undefined for in-process dispatch, which no surface restricts).
 * @internal Used by the flows around the entry code they run.
 */
export function runOnSurface<T>(surface: CallSurface | undefined, fn: () => Promise<T>): Promise<T> {
  return callSurfaces.run({ surface }, fn);
}

/**
 * The surface of the call the calling code serves: `'mcp'` inside a tool, resource read, prompt or
 * completion an MCP client asked for, `'cli'` for a CLI build's in-process client, `'agent'` in a tool
 * an agent's model called, `'job'` in a job (and the tools it calls), `'http-trigger'` in a channel
 * handling a webhook (and the tools it calls); undefined for in-process dispatch (a tool's
 * `this.callTool()`) or outside any call. Code that acts for the caller (running tools, listing
 * skills) must apply it the way the caller's own request would.
 */
export function getCallSurface(): CallSurface | undefined {
  return callSurfaces.getStore()?.surface;
}
