/**
 * The tool whose code is running (its construction or `execute()`), tracked per async call chain.
 *
 * One `FrontMcpContext` serves a whole request, and a request can run several tools: a tool that
 * calls another with `this.callTool()`, or several in parallel. Which tool a piece of code runs in
 * therefore cannot be a field of that object; it follows the async call chain instead, the way the
 * request context itself does. Providers read it when they are used, not when they are built, since a
 * CONTEXT provider can outlive the call that built it.
 */
import { AsyncLocalStorage } from '@frontmcp/utils';

/** A tool whose code is running. */
export interface RunningTool {
  /** The tool's name (`metadata.id ?? metadata.name`). */
  readonly name: string;
  /** Its owner-qualified name (`<owner id>:<name>`), unique within the server. */
  readonly fullName: string;
}

const runningTools = new AsyncLocalStorage<RunningTool>();

/**
 * Run `fn` as `tool`: the tool flows wrap both the construction of the tool's context and its
 * `execute()`, so work the tool's class starts while it is built is attributed to it too.
 * @internal Used by the tool flows.
 */
export function runAsTool<T>(tool: RunningTool, fn: () => T): T {
  return runningTools.run(tool, fn);
}

/**
 * The tool the calling code runs in (while it is built or while `execute()` runs), or undefined
 * outside one. A tool that calls other tools sees itself again once they return; tools running in
 * parallel each see themselves.
 */
export function getRunningTool(): RunningTool | undefined {
  return runningTools.getStore();
}
