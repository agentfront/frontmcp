import { App } from '@frontmcp/sdk';

import BusyRoute from './routes/busy.route';
import BusyWaitTool from './tools/busy-wait.tool';
import FailFastTool from './tools/fail-fast.tool';
import LaterBusyWaitTool from './tools/later-busy-wait.tool';

/** A tool that blocks the event loop, a tool that fails, and a route and a timer that block it outside a call. */
@App({
  name: 'stall-probe',
  description: 'A tool that blocks the event loop and a tool that fails',
  tools: [BusyWaitTool, FailFastTool, LaterBusyWaitTool],
  routes: [BusyRoute],
})
export class StallProbeApp {}
