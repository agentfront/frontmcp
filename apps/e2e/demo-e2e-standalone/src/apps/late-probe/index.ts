import { App } from '@frontmcp/sdk';

import { LateFeature } from './providers/late-feature.provider';
import StartLateFeatureTool from './tools/start-late-feature.tool';
import StopLateFeatureTool from './tools/stop-late-feature.tool';

/** Tools that start and stop a feature after the server is up; the feature reports itself on /readyz. */
@App({
  name: 'late-probe',
  description: 'Starts and stops a feature that adds a check to /readyz after startup',
  providers: [LateFeature],
  tools: [StartLateFeatureTool, StopLateFeatureTool],
})
export class LateProbeApp {}
