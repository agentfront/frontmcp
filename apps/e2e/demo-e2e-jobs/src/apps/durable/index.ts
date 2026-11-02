import { App } from '@frontmcp/sdk';

import { AnswerNowJob, OutlastTimeoutJob, ReportProgressJob, WaitForCancelJob } from './jobs/durable.jobs';
import { GetDurableLogTool } from './tools/durable-log.tools';

/** Jobs that are cancelled, time out, clean up and report progress (proposal 2.2 a). */
@App({
  name: 'Durable',
  description: 'Durable job runs: cancel, timeout, cleanup, admission and progress',
  jobs: [WaitForCancelJob, OutlastTimeoutJob, ReportProgressJob, AnswerNowJob],
  tools: [GetDurableLogTool],
})
export class DurableApp {}
