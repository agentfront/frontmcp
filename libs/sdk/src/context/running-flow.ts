/**
 * The flow whose stages are running, and the scope it runs in, tracked per async call chain.
 *
 * One `FrontMcpContext` serves a whole request, and a request can run several flows at once: a tool
 * that lists prompts while another tool call runs, or parallel workflow steps. Which flow a piece of
 * code runs in therefore cannot be a field of that object; it follows the async call chain instead,
 * the way the running tool does (`running-tool.ts`).
 */
import { AsyncLocalStorage } from '@frontmcp/utils';

import type { FrontMcpContext } from './frontmcp-context';

/** A flow whose stages are running for a request. */
export interface RunningFlow {
  /** The request context the flow runs for. */
  readonly context: FrontMcpContext;
  readonly flow: NonNullable<FrontMcpContext['flow']>;
  readonly scope: NonNullable<FrontMcpContext['scope']>;
}

const runningFlows = new AsyncLocalStorage<RunningFlow>();

/**
 * Run `fn` as `running`: until it settles, `context.flow` and `context.scope` name this flow and scope
 * in `fn`'s async call chain, and the outer ones again once it returns.
 * @internal Used by `FlowInstance.run`.
 */
export function runAsFlow<T>(running: RunningFlow, fn: () => T): T {
  return runningFlows.run(running, fn);
}

/** The innermost flow running for `context` in the calling async call chain, or undefined outside one. */
export function getRunningFlow(context: FrontMcpContext): RunningFlow | undefined {
  const running = runningFlows.getStore();
  return running?.context === context ? running : undefined;
}
