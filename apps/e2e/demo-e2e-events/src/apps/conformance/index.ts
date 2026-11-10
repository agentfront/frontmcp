import { App } from '@frontmcp/sdk';

import { conformanceEmitted } from './events/conformance-emitted.event';
import { conformanceGuarded, conformancePollOnly, conformanceWebhookOnly } from './events/conformance-guarded.event';
import { conformanceReplayed, conformanceUnreplayable } from './events/conformance-replayed.event';
import { ConformanceEmitTool, ConformanceRevokeTool, ConformanceUpstreamTool } from './tools/conformance-control.tools';

/** Test-only: the events and controls the conformance specs need, including conditions a healthy server never has. */
@App({
  name: 'conformance',
  description: 'Test-only events and controls for the MCP Events conformance specs',
  events: [
    conformanceEmitted,
    conformanceReplayed,
    conformanceUnreplayable,
    conformanceGuarded,
    conformanceWebhookOnly,
    conformancePollOnly,
  ],
  tools: [ConformanceEmitTool, ConformanceUpstreamTool, ConformanceRevokeTool],
})
export class ConformanceApp {}
