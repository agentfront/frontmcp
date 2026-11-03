import { InternalMcpError } from './mcp.error';

const NODE_ONLY_ENTRY_POINTS = {
  runShared: 'the shared local server needs stdio, a child process and a Unix socket or loopback port',
  runUnixSocket: 'a page cannot listen on a Unix socket',
} as const;

/** An entry point that needs Node, which a browser refuses. */
export type BrowserRefusedEntryPoint = keyof typeof NODE_ONLY_ENTRY_POINTS;

/** Thrown in a browser by an entry point that needs Node: a page has no stdio, child process or socket to listen on. */
export class BrowserEntryPointUnavailableError extends InternalMcpError {
  readonly entryPoint: BrowserRefusedEntryPoint;

  constructor(entryPoint: BrowserRefusedEntryPoint) {
    super(
      `A browser cannot run ${entryPoint}(): ${NODE_ONLY_ENTRY_POINTS[entryPoint]}. ` +
        'Call it from a Node entry, and use create() in a page',
      'BROWSER_ENTRY_POINT_UNAVAILABLE',
    );
    this.entryPoint = entryPoint;
  }
}
