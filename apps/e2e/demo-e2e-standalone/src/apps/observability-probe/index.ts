import { App } from '@frontmcp/sdk';

import GetTelemetryTool from './tools/get-telemetry.tool';
import RefusedAnswerTool from './tools/refused-answer.tool';

export { recordRequestLog } from './telemetry-records';

/**
 * Reports what `@frontmcp/observability` recorded for a call whose answer its output schema refuses.
 */
@App({
  name: 'observability-probe',
  description: 'A tool whose answer its output schema refuses, and what observability recorded for it',
  tools: [RefusedAnswerTool, GetTelemetryTool],
})
export class ObservabilityProbeApp {}
