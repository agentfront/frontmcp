import { App } from '@frontmcp/sdk';

import { heartbeatDuty } from './duties/heartbeat.duty';
import { clockTicked } from './events/clock-ticked.event';
import { fileAdded } from './events/file-added.event';
import { RecordOccurrenceJob } from './jobs/record-occurrence.job';
import { RecordedOccurrencesTool } from './tools/recorded-occurrences.tool';
import { clockWorker } from './workers/clock.worker';
import { inboxWatcher } from './workers/inbox-watcher.worker';
import { AuditOrdersWorkflow } from './workflows/audit-orders.workflow';

@App({
  name: 'sources',
  description: 'MCP Events E2E: events background code publishes, and a workflow a published event starts',
  events: [clockTicked, fileAdded],
  providers: [clockWorker, inboxWatcher, heartbeatDuty],
  jobs: [RecordOccurrenceJob],
  workflows: [AuditOrdersWorkflow],
  tools: [RecordedOccurrencesTool],
})
export class SourcesApp {}
