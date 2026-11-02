import { App } from '@frontmcp/sdk';

import BusyWaitTool from './tools/busy-wait.tool';
import FailFastTool from './tools/fail-fast.tool';

/** A tool that blocks the event loop and a tool that fails, for the stall detector. */
@App({
  name: 'stall-probe',
  description: 'A tool that blocks the event loop and a tool that fails',
  tools: [BusyWaitTool, FailFastTool],
})
export class StallProbeApp {}
