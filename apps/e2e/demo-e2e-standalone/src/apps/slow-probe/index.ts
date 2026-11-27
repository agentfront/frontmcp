import { App } from '@frontmcp/sdk';

import SlowWaitTool from './tools/slow-wait.tool';

/** A tool that stays quiet while it runs, for the response stream's keep-alive. */
@App({
  name: 'slow-probe',
  description: 'A tool that stays quiet while it runs',
  tools: [SlowWaitTool],
})
export class SlowProbeApp {}
