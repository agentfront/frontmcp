/**
 * The tool whose `execute()` is running, tracked per async call chain.
 *
 * One `FrontMcpContext` serves a whole request, and a request can run several tools: a tool that
 * calls another with `this.callTool()`, or several in parallel. Which tool a piece of code runs in
 * therefore cannot be a field of that object; it follows the async call chain instead, the way the
 * request context itself does. Providers read it when they are used, not when they are built, since a
 * CONTEXT provider can outlive the call that built it.
 */
import { AsyncLocalStorage } from '@frontmcp/utils';

/** A tool whose `execute()` is running. */
export interface RunningTool {
  /** The tool's name (`metadata.id ?? metadata.name`). */
  readonly name: string;
  /** Its owner-qualified name (`<owner id>:<name>`), unique within the server. */
  readonly fullName: string;
}

const runningTools = new AsyncLocalStorage<RunningTool>();

/**
 * Run `fn` as the execution of `tool`.
 * @internal Used by the tool flows around `execute()`.
 */
export function runAsTool<T>(tool: RunningTool, fn: () => Promise<T>): Promise<T> {
  return runningTools.run(tool, fn);
}

/**
 * The tool whose `execute()` the calling code runs in, or undefined outside one. A tool that calls
 * other tools sees itself again once they return; tools running in parallel each see themselves.
 */
export function getRunningTool(): RunningTool | undefined {
  return runningTools.getStore();
}
