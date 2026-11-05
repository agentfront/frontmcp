import { Tool, ToolContext } from '@frontmcp/sdk';

import { LateFeature } from '../providers/late-feature.provider';

@Tool({
  name: 'stop-late-feature',
  description: 'Stops the feature and removes its /readyz check',
  inputSchema: {},
})
export default class StopLateFeatureTool extends ToolContext {
  async execute(): Promise<string> {
    this.get(LateFeature).stop();
    return 'stopped';
  }
}
