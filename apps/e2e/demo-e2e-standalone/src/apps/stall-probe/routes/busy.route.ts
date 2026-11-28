import { HttpRoute, HttpRouteContext } from '@frontmcp/sdk';

/** Blocks the event loop for the given number of milliseconds, outside any MCP call. */
@HttpRoute({ method: 'GET', path: '/stall-probe/busy/:ms', auth: 'public' })
export default class BusyRoute extends HttpRouteContext {
  handle() {
    const ms = Math.min(Number(this.params['ms']) || 0, 5000);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Busy-waits on purpose: the stall detector must name this route.
    }
    return { blockedMs: ms };
  }
}
