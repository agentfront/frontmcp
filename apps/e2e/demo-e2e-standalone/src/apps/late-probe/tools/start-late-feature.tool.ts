import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { LateFeature } from '../providers/late-feature.provider';

@Tool({
  name: 'start-late-feature',
  description: 'Starts a feature that adds a check to /readyz',
  inputSchema: { healthy: z.boolean() },
})
export default class StartLateFeatureTool extends ToolContext {
  async execute(input: { healthy: boolean }): Promise<string> {
    this.get(LateFeature).start(this.scope, input.healthy);
    return 'started';
  }
}
